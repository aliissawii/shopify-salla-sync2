app.post(
  "/webhooks/salla",
  express.json(),
  async (req, res) => {
    try {
      console.log("===== SALLA EVENT RECEIVED =====");
      console.log("Event:", req.body.event);

      if (req.body.event === "app.store.authorize") {
        console.log("Merchant:", req.body.merchant);

        console.log(
          "Access Token:",
          req.body.data?.access_token
        );

        console.log(
          "Refresh Token:",
          req.body.data?.refresh_token
        );

        console.log(
          "Expires:",
          req.body.data?.expires
        );
      }

      return res.status(200).json({
        success: true
      });
    } catch (error) {
      console.error("Salla webhook error:", error);

      return res.status(500).json({
        success: false
      });
    }
  }
);
