require("dotenv").config();

const express = require("express");
const crypto = require("crypto");

const app = express();

app.use(express.json());
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;

const MTN_BASE_URL =
  process.env.MTN_BASE_URL || "https://sandbox.momodeveloper.mtn.com";

const SUBSCRIPTION_KEY = process.env.MTN_SUBSCRIPTION_KEY;
const API_USER = process.env.MTN_API_USER;
const API_KEY = process.env.MTN_API_KEY;

let accessToken = null;
let tokenExpiresAt = 0;


/*
====================================================
GET ACCESS TOKEN
====================================================
*/

async function getAccessToken() {

  if (accessToken && Date.now() < tokenExpiresAt) {
    return accessToken;
  }

  const credentials = Buffer
    .from(`${API_USER}:${API_KEY}`)
    .toString("base64");

  const response = await fetch(
    `${MTN_BASE_URL}/collection/token/`,
    {
      method: "POST",

      headers: {
        "Authorization": `Basic ${credentials}`,
        "Ocp-Apim-Subscription-Key": SUBSCRIPTION_KEY
      }
    }
  );

  const data = await response.json();

  if (!response.ok) {
    console.error("Token error:", data);
    throw new Error("Unable to obtain MTN access token");
  }

  accessToken = data.access_token;

  tokenExpiresAt =
    Date.now() +
    ((data.expires_in || 3600) - 60) * 1000;

  return accessToken;
}


/*
====================================================
START DONATION
====================================================
*/

app.post("/api/donate", async (req, res) => {

  try {

    const {
      amount,
      phone,
      name
    } = req.body;


    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid donation amount."
      });
    }


    if (!phone) {
      return res.status(400).json({
        success: false,
        message: "Phone number is required."
      });
    }


    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Name is required."
      });
    }


    /*
      Convert Ghanaian number to international format.

      Example:
      0241234567
      becomes
      233241234567
    */

    let momoNumber =
      phone.replace(/\s+/g, "");


    if (momoNumber.startsWith("0")) {
      momoNumber =
        "233" + momoNumber.substring(1);
    }

    if (momoNumber.startsWith("+")) {
      momoNumber =
        momoNumber.substring(1);
    }


    const token =
      await getAccessToken();


    const referenceId =
      crypto.randomUUID();


    const callbackUrl =
      process.env.CALLBACK_URL ||
      `${req.protocol}://${req.get("host")}/api/momo/callback`;


    const response = await fetch(
      `${MTN_BASE_URL}/collection/v1_0/requesttopay`,
      {
        method: "POST",

        headers: {
          "Authorization": `Bearer ${token}`,

          "X-Reference-Id":
            referenceId,

          "X-Target-Environment":
            process.env.MTN_TARGET_ENVIRONMENT ||
            "sandbox",

          "Ocp-Apim-Subscription-Key":
            SUBSCRIPTION_KEY,

          "Content-Type":
            "application/json",

          "X-Callback-Url":
            callbackUrl
        },

        body: JSON.stringify({

          amount:
            Number(amount).toFixed(2),

          currency:
            process.env.MTN_CURRENCY || "EUR",

          externalId:
            `DONATION-${referenceId}`,

          payer: {
            partyIdType: "MSISDN",
            partyId: momoNumber
          },

          payerMessage:
            "Donation",

          payeeNote:
            `Donation from ${name}`
        })
      }
    );


    if (response.status !== 202) {

      const errorText =
        await response.text();

      console.error(
        "MTN payment error:",
        errorText
      );

      return res.status(500).json({
        success: false,
        message:
          "MTN could not start the payment."
      });
    }


    res.json({

      success: true,

      referenceId,

      message:
        "Payment request sent. Please approve it on your MTN MoMo phone."
    });


  } catch (error) {

    console.error(error);

    res.status(500).json({

      success: false,

      message:
        "Unable to start payment."
    });

  }

});


/*
====================================================
CHECK PAYMENT STATUS
====================================================
*/

app.get(
  "/api/donation/:referenceId",
  async (req, res) => {

    try {

      const token =
        await getAccessToken();

      const referenceId =
        req.params.referenceId;


      const response = await fetch(

        `${MTN_BASE_URL}/collection/v1_0/requesttopay/${referenceId}`,

        {
          method: "GET",

          headers: {

            "Authorization":
              `Bearer ${token}`,

            "X-Target-Environment":
              process.env.MTN_TARGET_ENVIRONMENT ||
              "sandbox",

            "Ocp-Apim-Subscription-Key":
              SUBSCRIPTION_KEY
          }
        }

      );


      const data =
        await response.json();


      res.json(data);


    } catch (error) {

      console.error(error);

      res.status(500).json({

        success: false,

        message:
          "Unable to check payment status."

      });

    }

  }
);


/*
====================================================
MTN CALLBACK
====================================================
*/

app.post(
  "/api/momo/callback",
  (req, res) => {

    console.log(
      "MTN CALLBACK:",
      req.body
    );

    /*
      In production, save the transaction
      status in your database here.
    */

    res.status(200).send("OK");

  }
);


/*
====================================================
START SERVER
====================================================
*/

app.listen(PORT, () => {

  console.log(
    `Donation server running on port ${PORT}`
  );

});