import express from "express";

const app = express();

/* ==========================================
   HOME / HEALTH CHECK
========================================== */

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Shopify → Salla bridge is running"
  });
});


/* ==========================================
   SHOPIFY → SALLA ORDER WEBHOOK
========================================== */

app.post(
  "/webhooks/shopify/order",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      const order = JSON.parse(
        req.body.toString("utf8")
      );

      console.log("===== SHOPIFY ORDER RECEIVED =====");
      console.log("Shopify ID:", order.id);
      console.log("Order:", order.name);
      console.log("Total:", order.total_price);
      console.log("Currency:", order.currency);

      /* -------------------------------------
         CHECK SALLA TOKEN
      ------------------------------------- */

      if (!process.env.SALLA_ACCESS_TOKEN) {
        console.error("SALLA_ACCESS_TOKEN is missing");

        return res.status(500).json({
          success: false,
          error: "SALLA_ACCESS_TOKEN is missing"
        });
      }

      /* -------------------------------------
         PRODUCTS
      ------------------------------------- */

      const products = (order.line_items || []).map(
        (item) => ({
          name: item.name || item.title,
          price: Number(item.price || 0),
          cost_price: 0,
          sku: item.sku || "",
          weight: Number(item.grams || 0),
          quantity: Number(item.quantity || 1),
          weight_type: "g",
          require_shipping:
            item.requires_shipping === false ? 0 : 1,
          product_type: "product",
          product_discount:
            Number(item.total_discount || 0)
        })
      );

      /* -------------------------------------
         SHIPPING COST
      ------------------------------------- */

      const shippingCost = (
        order.shipping_lines || []
      ).reduce(
        (sum, line) =>
          sum + Number(line.price || 0),
        0
      );

      /* -------------------------------------
         TAX
      ------------------------------------- */

      const taxValue = Number(
        order.total_tax || 0
      );

      let taxRate = 0;

      if (order.tax_lines?.length) {
        taxRate =
          Number(order.tax_lines[0].rate || 0) *
          100;
      }

      /* -------------------------------------
         PAYMENT METHOD
      ------------------------------------- */

      const gateway =
        order.payment_gateway_names?.[0] ||
        order.gateway ||
        "shopify";

      const gatewayLower =
        gateway.toLowerCase();

      let paymentMethod = "credit_card";

      if (
        gatewayLower.includes("cash") ||
        gatewayLower.includes("cod")
      ) {
        paymentMethod = "cod";
      } else if (
        gatewayLower.includes("bank")
      ) {
        paymentMethod = "bank";
      } else if (
        gatewayLower.includes("apple")
      ) {
        paymentMethod = "apple_pay";
      } else if (
        gatewayLower.includes("mada")
      ) {
        paymentMethod = "mada";
      } else if (
        gatewayLower.includes("paypal")
      ) {
        paymentMethod = "paypal";
      } else if (
        gatewayLower.includes("tabby")
      ) {
        paymentMethod = "tabby_installment";
      } else if (
        gatewayLower.includes("tamara")
      ) {
        paymentMethod = "tamara_installment";
      }

      const paymentStatus =
        order.financial_status === "paid"
          ? "paid"
          : "pending";

      /* -------------------------------------
         CUSTOMER / RECEIVER
      ------------------------------------- */

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
        address.phone ||
        order.phone ||
        order.customer?.phone ||
        "";

      const email =
        order.email ||
        order.customer?.email ||
        "";

      /* -------------------------------------
         BUILD SALLA ORDER
      ------------------------------------- */

      const sallaPayload = {
        external_order_id: String(order.id),

        date: order.created_at
          ? order.created_at
              .slice(0, 16)
              .replace("T", " ")
          : undefined,

        currency: order.currency || "SAR",

        exchange_currency_rate: 1,

        subtotal: Number(
          order.subtotal_price || 0
        ),

        source: "shopify",

        tax: {
          rate: taxRate,
          value: taxValue
        },

        products: products,

        discounts: {
          code:
            order.discount_codes?.[0]?.code ||
            "",
          amount: Number(
            order.total_discounts || 0
          ),
          shipping_amount: 0
        },

        payment: {
          status: paymentStatus,
          method: paymentMethod,

          gateway: {
            label: gateway,
            reference_id: String(order.id)
          },

          ...(paymentMethod === "cod"
            ? {
                cash_on_delivery: {
                  amount: Number(
                    order.total_price || 0
                  )
                }
              }
            : {})
        },

        receiver: {
          name: receiverName,
          phone: phone,
          country_code:
            (
              address.country_code ||
              "SA"
            ).toLowerCase(),
          email: email,
          notify: 0
        },

        shipping_cost: shippingCost
      };

      console.log(
        "Sending Shopify order to Salla:",
        order.id
      );

      /* -------------------------------------
         SEND TO SALLA
      ------------------------------------- */

      const sallaResponse = await fetch(
        "https://api.salla.dev/admin/v2/orders/external",
        {
          method: "POST",

          headers: {
            Authorization:
              `Bearer ${process.env.SALLA_ACCESS_TOKEN}`,

            "Content-Type":
              "application/json",

            Accept: "application/json"
          },

          body: JSON.stringify(sallaPayload)
        }
      );

      const sallaResult =
        await sallaResponse.json();

      console.log(
        "Salla HTTP status:",
        sallaResponse.status
      );

      console.log(
        "Salla response:",
        JSON.stringify(sallaResult)
      );

      /* -------------------------------------
         SALLA ERROR
      ------------------------------------- */

      if (!sallaResponse.ok) {
        console.error(
          "Salla rejected Shopify order:",
          JSON.stringify(sallaResult)
        );

        return res.status(500).json({
          success: false,
          shopify_order: order.id,
          salla_status: sallaResponse.status,
          salla: sallaResult
        });
      }

      /* -------------------------------------
         SUCCESS
      ------------------------------------- */

      console.log(
        "✅ SHOPIFY ORDER CREATED IN SALLA"
      );

      console.log(
        "Shopify:",
        order.id
      );

      console.log(
        "Salla:",
        sallaResult?.data?.id
      );

      return res.status(200).json({
        success: true,

        message:
          "Shopify order successfully sent to Salla",

        shopify_order_id:
          String(order.id),

        salla_order_id:
          sallaResult?.data?.id,

        salla_reference_id:
          sallaResult?.data?.reference_id
      });

    } catch (error) {
      console.error(
        "Shopify → Salla error:",
        error
      );

      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);


/* ==========================================
   SALLA WEBHOOK
========================================== */

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

      // IMPORTANT:
      // We intentionally DO NOT log access tokens anymore.

      return res.status(200).json({
        success: true
      });

    } catch (error) {
      console.error(
        "Salla webhook error:",
        error
      );

      return res.status(500).json({
        success: false
      });
    }
  }
);


export default app;
