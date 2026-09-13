import express from "express";

const app = express();

/* ==========================================
   HEALTH CHECK
========================================== */

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Shopify → Salla bridge is running"
  });
});


/* ==========================================
   SHOPIFY ORDER WEBHOOK
========================================== */

app.post(
  "/webhooks/shopify/order",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      const rawBody = req.body.toString("utf8");

      const order = JSON.parse(rawBody);

      console.log("===== SHOPIFY ORDER RECEIVED =====");
      console.log("Order ID:", order.id);
      console.log("Order Number:", order.name);
      console.log("Email:", order.email);
      console.log("Currency:", order.currency);
      console.log("Total:", order.total_price);

      console.log(
        "Products:",
        order.line_items?.map((item) => ({
          name: item.name,
          sku: item.sku,
          quantity: item.quantity,
          price: item.price
        }))
      );

      return res.status(200).json({
        success: true,
        message: "Shopify order received",
        order_id: order.id,
        order_number: order.name
      });

    } catch (error) {

      console.error(
        "Shopify webhook error:",
        error
      );

      return res.status(400).json({
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

      if (
        req.body?.event ===
        "app.store.authorize"
      ) {

        console.log(
          "Merchant:",
          req.body?.merchant
        );

        console.log(
          "Access Token:",
          req.body?.data?.access_token
        );

        console.log(
          "Refresh Token:",
          req.body?.data?.refresh_token
        );

        console.log(
          "Expires:",
          req.body?.data?.expires
        );
      }

      return res.status(200).json({
        success: true
      });

    } catch (error) {

      console.error(
        "Salla webhook error:",
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
   EXPORT FOR VERCEL
========================================== */

export default app;
