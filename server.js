import express from "express";
import crypto from "node:crypto";

const app = express();

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Shopify → Salla bridge is running"
  });
});

app.post(
  "/webhooks/shopify/order",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      // 1. Verify Shopify webhook
      const shopifyHmac =
        req.headers["x-shopify-hmac-sha256"];

      const calculatedHmac = crypto
        .createHmac(
          "sha256",
          process.env.SHOPIFY_WEBHOOK_SECRET
        )
        .update(req.body)
        .digest("base64");

      if (!shopifyHmac) {
        return res.status(401).send("Missing signature");
      }

      const received = Buffer.from(shopifyHmac);
      const calculated = Buffer.from(calculatedHmac);

      if (
        received.length !== calculated.length ||
        !crypto.timingSafeEqual(received, calculated)
      ) {
        return res.status(401).send("Invalid Shopify signature");
      }

      // 2. Parse Shopify order
      const order = JSON.parse(
        req.body.toString("utf8")
      );

      console.log(
        "Shopify order received:",
        order.id
      );

      // 3. Build Salla products
      const products = order.line_items.map((item) => ({
        name: item.name,
        price: Number(item.price),
        sku: item.sku || "",
        quantity: item.quantity,
        weight: item.grams || 0,
        weight_type: "g",
        require_shipping:
          item.requires_shipping ? 1 : 0,
        product_type: "product"
      }));

      const shippingCost =
        order.shipping_lines?.reduce(
          (total, shipping) =>
            total + Number(shipping.price || 0),
          0
        ) || 0;

      const discountAmount =
        Number(order.total_discounts || 0);

      const totalTax =
        Number(order.total_tax || 0);

      // 4. Create external Salla order
      const sallaOrder = {
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

        products,

        shipping_cost: shippingCost,

        discounts: {
          code:
            order.discount_codes?.[0]?.code || "",
          amount: discountAmount,
          shipping_amount: 0
        },

        tax: {
          rate:
            order.tax_lines?.[0]?.rate
              ? Number(
                  order.tax_lines[0].rate
                ) * 100
              : 0,

          value: totalTax
        },

        payment: {
          status:
            order.financial_status === "paid"
              ? "paid"
              : "pending",

          method:
            order.gateway === "Cash on Delivery"
              ? "cod"
              : "credit_card",

          gateway: {
            label:
              order.gateway || "shopify",
            reference_id:
              String(order.id)
          }
        },

        receiver: {
          name:
            order.shipping_address?.name ||
            order.customer?.first_name ||
            "Shopify Customer",

          phone:
            order.shipping_address?.phone ||
            order.phone ||
            "",

          country_code:
            order.shipping_address
              ?.country_code || "SA",

          email:
            order.email ||
            order.customer?.email ||
            "",

          notify: 0
        }
      };

      const response = await fetch(
        "https://api.salla.dev/admin/v2/orders/external",
        {
          method: "POST",

          headers: {
            Authorization:
              `Bearer ${process.env.SALLA_ACCESS_TOKEN}`,

            "Content-Type":
              "application/json"
          },

          body: JSON.stringify(sallaOrder)
        }
      );

      const result = await response.json();

      console.log(
        "Salla response:",
        JSON.stringify(result)
      );

      if (!response.ok) {
        console.error(result);

        return res.status(500).json({
          success: false,
          message:
            "Salla rejected the order",
          salla: result
        });
      }

      return res.status(200).json({
        success: true,
        shopifyOrder: order.id,
        salla: result
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

export default app;
