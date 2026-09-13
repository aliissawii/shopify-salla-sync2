import express from "express";
import crypto from "node:crypto";

const app = express();

/* =========================================================
   HEALTH CHECK
========================================================= */

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Shopify → Salla bridge is running"
  });
});


/* =========================================================
   OPTIONAL SHOPIFY WEBHOOK VERIFICATION
   If SHOPIFY_WEBHOOK_SECRET is not set yet,
   the webhook will still work for testing.
========================================================= */

function verifyShopifyWebhook(req) {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;

  // Testing mode
  if (!secret) {
    console.warn(
      "⚠️ SHOPIFY_WEBHOOK_SECRET not set - skipping HMAC verification"
    );
    return true;
  }

  const receivedHmac =
    req.headers["x-shopify-hmac-sha256"];

  if (!receivedHmac) {
    return false;
  }

  const calculatedHmac = crypto
    .createHmac("sha256", secret)
    .update(req.body)
    .digest("base64");

  const receivedBuffer =
    Buffer.from(receivedHmac, "utf8");

  const calculatedBuffer =
    Buffer.from(calculatedHmac, "utf8");

  if (
    receivedBuffer.length !==
    calculatedBuffer.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    receivedBuffer,
    calculatedBuffer
  );
}


/* =========================================================
   SHOPIFY ORDER → SALLA
========================================================= */

app.post(
  "/webhooks/shopify/order",

  express.raw({
    type: "application/json"
  }),

  async (req, res) => {
    try {

      /* -----------------------------------------------------
         VERIFY SHOPIFY
      ----------------------------------------------------- */

      if (!verifyShopifyWebhook(req)) {
        console.error(
          "❌ Invalid Shopify webhook signature"
        );

        return res.status(401).json({
          success: false,
          error: "Invalid Shopify signature"
        });
      }


      /* -----------------------------------------------------
         READ SHOPIFY ORDER
      ----------------------------------------------------- */

      const order = JSON.parse(
        req.body.toString("utf8")
      );

      console.log(
        "===== SHOPIFY ORDER RECEIVED ====="
      );

      console.log(
        "Shopify ID:",
        order.id
      );

      console.log(
        "Order:",
        order.name
      );

      console.log(
        "Total:",
        order.total_price
      );

      console.log(
        "Currency:",
        order.currency
      );


      /* -----------------------------------------------------
         CHECK SALLA TOKEN
      ----------------------------------------------------- */

      if (!process.env.SALLA_ACCESS_TOKEN) {

        console.error(
          "❌ SALLA_ACCESS_TOKEN missing"
        );

        return res.status(500).json({
          success: false,
          error:
            "SALLA_ACCESS_TOKEN is not configured"
        });
      }


      /* -----------------------------------------------------
         PRODUCTS
      ----------------------------------------------------- */

      const products =
        (order.line_items || []).map(
          (item) => {

            /*
             Shopify gives tax lines
             separately for each item.
            */

            const itemTaxValue =
              (item.tax_lines || [])
                .reduce(
                  (total, tax) => {

                    const value =
                      tax.price ??
                      tax.price_set
                        ?.shop_money
                        ?.amount ??
                      0;

                    return (
                      total +
                      Number(value)
                    );

                  },
                  0
                );


            const itemTaxRate =
              (item.tax_lines || [])
                .reduce(
                  (total, tax) => {

                    return (
                      total +
                      (
                        Number(
                          tax.rate || 0
                        ) * 100
                      )
                    );

                  },
                  0
                );


            return {

              name:
                item.name ||
                item.title ||
                "Shopify Product",

              price:
                Number(
                  item.price || 0
                ),

              cost_price: 0,

              sku:
                item.sku || "",

              weight:
                Number(
                  item.grams || 0
                ),

              quantity:
                Number(
                  item.quantity || 1
                ),

              weight_type: "g",

              require_shipping:
                item.requires_shipping === false
                  ? 0
                  : 1,

              product_type:
                "product",

              product_discount:
                Number(
                  item.total_discount ||
                  0
                ),

              /*
               IMPORTANT:
               Salla requires product tax.value
              */

              tax: {
                rate:
                  Number(
                    itemTaxRate.toFixed(4)
                  ),

                value:
                  Number(
                    itemTaxValue.toFixed(2)
                  )
              }
            };
          }
        );


      /* -----------------------------------------------------
         SHIPPING COST
      ----------------------------------------------------- */

      const shippingCost =
        (order.shipping_lines || [])
          .reduce(
            (total, shipping) => {

              return (
                total +
                Number(
                  shipping.price || 0
                )
              );

            },
            0
          );


      /* -----------------------------------------------------
         ORDER TAX
      ----------------------------------------------------- */

      const totalTax =
        Number(
          order.total_tax || 0
        );


      const taxRate =
        (order.tax_lines || [])
          .reduce(
            (total, tax) => {

              return (
                total +
                (
                  Number(
                    tax.rate || 0
                  ) * 100
                )
              );

            },
            0
          );


      /* -----------------------------------------------------
         PAYMENT
      ----------------------------------------------------- */

      const gateway =
        order.payment_gateway_names?.[0] ||
        order.gateway ||
        "Shopify";


      const gatewayLower =
        gateway.toLowerCase();


      /*
       Keep payment methods simple
       while we're testing.
      */

      let paymentMethod =
        "credit_card";


      if (
        gatewayLower.includes("cash") ||
        gatewayLower.includes("cod")
      ) {

        paymentMethod =
          "cod";

      } else if (
        gatewayLower.includes("bank")
      ) {

        paymentMethod =
          "bank";
      }


      /*
       FIX:
       "pending" was rejected by Salla.

       Salla documents pending_payment
       for orders waiting for payment.
      */

      const paymentStatus =
        order.financial_status === "paid"
          ? "paid"
          : "pending_payment";


      /* -----------------------------------------------------
         CUSTOMER / RECEIVER
      ----------------------------------------------------- */

      const address =
        order.shipping_address ||
        order.billing_address ||
        {};


      const receiverName =
        address.name ||

        `${order.customer?.first_name || ""} ${
          order.customer?.last_name || ""
        }`.trim() ||

        "Shopify Customer";


      const phone =
        (
          address.phone ||
          order.phone ||
          order.customer?.phone ||
          ""
        ).trim();


      const email =
        order.email ||
        order.customer?.email ||
        "";


      const countryCode =
        (
          address.country_code ||
          address.country_code_v2 ||
          "EG"
        )
          .toLowerCase();


      /* -----------------------------------------------------
         DISCOUNTS
      ----------------------------------------------------- */

      const discountCode =
        order.discount_codes?.[0]?.code ||
        "";


      const discountAmount =
        Number(
          order.total_discounts || 0
        );


      /* -----------------------------------------------------
         BUILD SALLA PAYLOAD
      ----------------------------------------------------- */

      const sallaPayload = {

        external_order_id:
          String(order.id),

        date:
          order.created_at
            ? order.created_at
                .slice(0, 16)
                .replace(
                  "T",
                  " "
                )
            : undefined,

        currency:
          order.currency || "EGP",

        exchange_currency_rate:
          1,

        subtotal:
          Number(
            order.subtotal_price || 0
          ),

        source:
          "shopify",


        /* ORDER TAX */

        tax: {
          rate:
            Number(
              taxRate.toFixed(4)
            ),

          value:
            Number(
              totalTax.toFixed(2)
            )
        },


        /* PRODUCTS */

        products,


        /* DISCOUNTS */

        discounts: {
          code:
            discountCode,

          amount:
            discountAmount,

          shipping_amount:
            0
        },


        /* PAYMENT */

        payment: {

          status:
            paymentStatus,

          method:
            paymentMethod,

          gateway: {

            label:
              gateway,

            reference_id:
              String(order.id)
          },

          ...(paymentMethod === "cod"
            ? {
                cash_on_delivery: {

                  amount:
                    Number(
                      order.total_price ||
                      0
                    )
                }
              }
            : {})
        },


        /*
         FIX:
         Salla requires receiver.phone
         whenever receiver exists.

         Therefore receiver is only
         included when Shopify actually
         supplied a phone.
        */

        ...(phone
          ? {

              receiver: {

                name:
                  receiverName,

                phone:
                  phone,

                country_code:
                  countryCode,

                email:
                  email,

                notify:
                  0
              }

            }
          : {}),


        shipping_cost:
          Number(
            shippingCost.toFixed(2)
          )
      };


      /* -----------------------------------------------------
         DEBUG WITHOUT SHOWING SECRETS
      ----------------------------------------------------- */

      console.log(
        "Sending Shopify order to Salla:",
        order.id
      );

      console.log(
        "Products:",
        products.length
      );

      console.log(
        "Receiver phone available:",
        Boolean(phone)
      );

      console.log(
        "Payment status:",
        paymentStatus
      );

      console.log(
        "Payment method:",
        paymentMethod
      );


      /* -----------------------------------------------------
         SEND TO SALLA
      ----------------------------------------------------- */

      const sallaResponse =
        await fetch(

          "https://api.salla.dev/admin/v2/orders/external",

          {
            method: "POST",

            headers: {

              Authorization:
                `Bearer ${process.env.SALLA_ACCESS_TOKEN}`,

              "Content-Type":
                "application/json",

              Accept:
                "application/json"
            },

            body:
              JSON.stringify(
                sallaPayload
              )
          }
        );


      /* -----------------------------------------------------
         READ SALLA RESPONSE
      ----------------------------------------------------- */

      const responseText =
        await sallaResponse.text();


      let sallaResult;


      try {

        sallaResult =
          JSON.parse(
            responseText
          );

      } catch {

        sallaResult = {
          raw:
            responseText
        };
      }


      console.log(
        "Salla HTTP status:",
        sallaResponse.status
      );


      console.log(
        "Salla response:",
        JSON.stringify(
          sallaResult
        )
      );


      /* -----------------------------------------------------
         SALLA ERROR
      ----------------------------------------------------- */

      if (!sallaResponse.ok) {

        console.error(
          "===== SALLA VALIDATION ERROR ====="
        );


        console.error(
          JSON.stringify(
            sallaResult,
            null,
            2
          )
        );


        if (
          sallaResult?.error?.fields
        ) {

          for (
            const [
              field,
              errors
            ]
            of Object.entries(
              sallaResult.error.fields
            )
          ) {

            console.error(
              `FIELD ERROR → ${field}:`,
              JSON.stringify(
                errors
              )
            );
          }
        }


        return res.status(500).json({

          success:
            false,

          shopify_order:
            String(order.id),

          salla_status:
            sallaResponse.status,

          salla:
            sallaResult
        });
      }


      /* -----------------------------------------------------
         SUCCESS
      ----------------------------------------------------- */

      console.log(
        "✅ SHOPIFY ORDER CREATED IN SALLA"
      );


      console.log(
        "Shopify Order:",
        order.id
      );


      console.log(
        "Salla Order:",
        sallaResult?.data?.id
      );


      console.log(
        "Salla Reference:",
        sallaResult?.data
          ?.reference_id
      );


      return res.status(200).json({

        success:
          true,

        message:
          "Shopify order successfully created in Salla",

        shopify_order_id:
          String(order.id),

        salla_order_id:
          sallaResult?.data?.id,

        salla_reference_id:
          sallaResult?.data
            ?.reference_id
      });


    } catch (error) {

      console.error(
        "❌ Shopify → Salla error:",
        error
      );


      return res.status(500).json({

        success:
          false,

        error:
          error.message
      });
    }
  }
);


/* =========================================================
   SALLA WEBHOOK
========================================================= */

app.post(
  "/webhooks/salla",

  express.json(),

  async (req, res) => {

    try {

      console.log(
        "===== SALLA EVENT RECEIVED ====="
      );


      console.log(
        "Event:",
        req.body?.event
      );


      console.log(
        "Merchant:",
        req.body?.merchant
      );


      /*
       IMPORTANT:
       Never print access_token or
       refresh_token into production logs.
      */


      return res.status(200).json({
        success:
          true
      });


    } catch (error) {

      console.error(
        "Salla webhook error:",
        error
      );


      return res.status(500).json({
        success:
          false
      });
    }
  }
);


export default app;
