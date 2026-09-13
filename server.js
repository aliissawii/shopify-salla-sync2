import express from "express";

const app = express();

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Shopify → Salla bridge is running"
  });
});

// Shopify sends orders here
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
      console.error("Webhook error:", error);

      return res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }
);

export default app;
