const { WebhookClient, Payload } = require("dialogflow-fulfillment");
const express = require("express");
const { json } = require("express");
const cors = require("cors");
const axios = require("axios");
require("dotenv").config();

// In-memory session history
const sessionHistory = new Map();

const app = express();
app.use(json());
app.use(cors());

const PORT = process.env.PORT || 5000;
const GOOGLE_SHEET_URL = process.env.GOOGLE_SHEET_URL;

// Pricing table
const pricingTable = {
  chatbot: { basePrice: 500, features: { crm: 200, multilingual: 150, voice: 300 } },
  "voice assistant": { basePrice: 800, features: { crm: 250, multilingual: 200 } },
  "faq bot": { basePrice: 300, features: { crm: 150, multilingual: 100 } },
  automation: { basePrice: 600, features: { crm: 200, googleSheets: 100 } }
};

// Test Google Sheets connection on startup
async function testGoogleSheetConnection() {
  try {
    const testData = {
      sessionId: "test-session",
      email: "test-email",
      service: "test-service",
      platform: "test-platform",
      features: ["test-feature"],
      leadStatus: "Test",
      issue: "Test issue"
    };
    const res = await axios.post(GOOGLE_SHEET_URL, testData, { headers: { "Content-Type": "application/json" } });
    console.log("Google Sheets Connection Successful! Response:", res.data);
  } catch (error) {
    console.error("Google Sheets Connection Failed! Error:", error.response?.data || error.message);
  }
}

// Log to Google Sheets
async function logToGoogleSheet(sessionId, email = "", service = "", platform = "", features = [], leadStatus = "Potential Lead", issue = "") {
  const data = { sessionId, email, service, platform, features, leadStatus, issue };
  console.log("Attempting to log to Google Sheets:", data);
  try {
    const res = await axios.post(GOOGLE_SHEET_URL, data, { headers: { "Content-Type": "application/json" } });
    console.log("Successfully logged to Google Sheet:", res.data);
  } catch (error) {
    console.error("Failed to log to Google Sheet:", error.response?.data || error.message);
  }
}

// Webhook handler
app.post("/webhook", async (req, res) => {
  console.log("Webhook received request at", new Date().toISOString(), "Body:", req.body);
  try {
    const agent = new WebhookClient({ request: req, response: res });
    const sessionId = agent.session.split("/").pop();
    let history = sessionHistory.get(sessionId) || [];

    // Intent handlers
    async function hi(agent) {
      console.log(`intent  =>  hi`);
      agent.add("hi this dialogflow response");

      const payload = {
        "richContent": [
          [
            {
              "options": [
                { "text": "Dr. Issa Nagari" },
                { "text": "Prof. Amir" },
                { "text": "Dr. Jhon patrick" },
                { "text": "Sara kirchoff" },
                { "text": "location" }
              ],
              "type": "chips"
            }
          ]
        ]
      };
      agent.add(
        new Payload("DIALOGFLOW_MESSENGER", payload, {
          rawPayload: true,
          sendAsMessage: true,
        })
      );
    }

    async function reportIssue(agent) {
      console.log("intent => ReportIssue");
      // This intent is triggered when the user says something like "I m facing an issue"
      // The static response "I'm here to help! Could you please describe the issue you're facing?..." is set in Dialogflow
      // No additional webhook handling needed here unless you want to customize the response
    }

    async function reportIssueDetails(agent) {
      console.log("intent => ReportIssue - Details");
      const issue = agent.query; // Capture the user's full query as the issue description
      console.log("Reported issue:", issue);

      // Store the issue in session history for logging
      history.push({ issue, intent: "ReportIssue - Details" });
      sessionHistory.set(sessionId, history);

      agent.add("Thank you for reporting the issue. Our team will look into the server error with your chatbot and get back to you. Would you like to provide an email for follow-up?");
      const payload = {
        "richContent": [
          [
            {
              "options": [
                { "text": "Yes, provide email" },
                { "text": "No, thanks" }
              ],
              "type": "chips"
            }
          ]
        ]
      };
      agent.add(
        new Payload("DIALOGFLOW_MESSENGER", payload, {
          rawPayload: true,
          sendAsMessage: true,
        })
      );
    }

    async function quoteSimulator(agent) {
      console.log("intent => QuoteSimulator");
      const service = agent.parameters.service?.toLowerCase();
      const platform = agent.parameters.platform?.toLowerCase();
      const features = agent.parameters.features || [];
      const quantity = parseInt(agent.parameters.quantity) || 1;

      history.push({ service, platform, features, intent: "QuoteSimulator" });
      sessionHistory.set(sessionId, history);

      if (pricingTable[service]) {
        let totalPrice = pricingTable[service].basePrice * quantity;
        let featureDetails = [];
        features.forEach((feature) => {
          if (pricingTable[service].features[feature]) {
            totalPrice += pricingTable[service].features[feature];
            featureDetails.push(`${feature}: €${pricingTable[service].features[feature]}`);
          }
        });

        let response = `The quote for ${quantity} ${service}(s) is €${totalPrice}.`;
        if (platform) response += ` Deployable on ${platform}.`;
        if (featureDetails.length) response += ` Features: ${featureDetails.join(", ")}.`;
        response += ` Would you like to provide an email to discuss this quote further?`;

        agent.add(response);
        const payload = {
          "richContent": [
            [
              {
                "options": [
                  { "text": "Yes, provide email" },
                  { "text": "No, just info" }
                ],
                "type": "chips"
              }
            ]
          ]
        };
        agent.add(
          new Payload("DIALOGFLOW_MESSENGER", payload, {
            rawPayload: true,
            sendAsMessage: true,
          })
        );
      } else {
        const query = `Generate a price quote for a custom ${service} with features: ${features.join(", ")} on platform: ${platform || "unspecified"}. Provide a brief explanation.`;
        const data = {
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: "You are a pricing assistant for an AI chatbot agency. Provide realistic quotes based on services like chatbots (€300-800), voice assistants (€800+), and features like CRM integration (€150-250) or multilingual support (€100-200).",
            },
            { role: "user", content: query },
          ],
        };
        const config = {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          },
        };
        try {
          const response = await axios.post("https://api.openai.com/v1/chat/completions", data, config);
          const text = `${response.data?.choices[0]?.message?.content} Would you like to provide an email to discuss this quote further?`;
          agent.add(text);
          const payload = {
            "richContent": [
              [
                {
                  "options": [
                    { "text": "Yes, provide email" },
                    { "text": "No, just info" }
                  ],
                  "type": "chips"
                }
              ]
            ]
          };
          agent.add(
            new Payload("DIALOGFLOW_MESSENGER", payload, {
              rawPayload: true,
              sendAsMessage: true,
            })
          );
        } catch (error) {
          const text = "Sorry, I couldn't generate a quote. Please try again.";
          agent.add(text);
          const payload = {
            "richContent": [
              [
                {
                  "options": [
                    { "text": "Try again" }
                  ],
                  "type": "chips"
                }
              ]
            ]
          };
          agent.add(
            new Payload("DIALOGFLOW_MESSENGER", payload, {
              rawPayload: true,
              sendAsMessage: true,
            })
          );
          console.error("QuoteSimulator GPT error:", error);
        }
      }
    }

    async function collectLead(agent) {
      const email = agent.parameters.email;
      console.log("Captured email:", email);
      const lastMessage = history.length > 1 ? history[history.length - 2] : null;
      let service = "", platform = "", features = [], issue = "", leadStatus = "Potential Lead";

      if (lastMessage) {
        if (lastMessage.intent === "QuoteSimulator") {
          service = lastMessage.service || "";
          platform = lastMessage.platform || "";
          features = lastMessage.features || [];
          leadStatus = "Potential Lead";
        } else if (lastMessage.intent === "ReportIssue - Details") {
          issue = lastMessage.issue || "";
          leadStatus = "Issue Reported";
        }
      }

      let text;
      if (lastMessage && lastMessage.intent === "QuoteSimulator") {
        text = `Thank you! We'll follow up at ${email} regarding a ${service || "service"}. Anything else we can help with?`;
      } else if (lastMessage && lastMessage.intent === "ReportIssue - Details") {
        text = `Thank you! We'll follow up at ${email} regarding your issue: ${issue}. Anything else we can help with?`;
      } else {
        text = `Thank you! We'll follow up at ${email} to discuss your needs. Anything else we can help with?`;
      }
      agent.add(text);
      const payload = {
        "richContent": [
          [
            {
              "options": [
                { "text": "Yes, more help" },
                { "text": "No, done" }
              ],
              "type": "chips"
            }
          ]
        ]
      };
      agent.add(
        new Payload("DIALOGFLOW_MESSENGER", payload, {
          rawPayload: true,
          sendAsMessage: true,
        })
      );

      await logToGoogleSheet(sessionId, email, service, platform, features, leadStatus, issue);
    }

    async function queryGPT(agent) {
      console.log("intent => Default Fallback Intent");
      const query = agent.query;
      const data = {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are a helpful assistant for an AI chatbot agency. Answer based on services like custom chatbots, voice assistants, and integrations.",
          },
          { role: "user", content: query },
        ],
      };
      const config = {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
      };
      try {
        const response = await axios.post("https://api.openai.com/v1/chat/completions", data, config);
        const text = response.data?.choices[0]?.message?.content;
        agent.add(text);
        const payload = {
          "richContent": [
            [
              {
                "options": [
                  { "text": "Ask another question" }
                ],
                "type": "chips"
              }
            ]
          ]
        };
        agent.add(
          new Payload("DIALOGFLOW_MESSENGER", payload, {
            rawPayload: true,
            sendAsMessage: true,
          })
        );
      } catch (error) {
        const text = `Sorry, I couldn't process your request due to an error: ${error.message || "Unknown error"}. Please try again or contact support.`;
        agent.add(text);
        const payload = {
          "richContent": [
            [
              {
                "options": [
                  { "text": "Try again" },
                  { "text": "Contact support" }
                ],
                "type": "chips"
              }
            ]
          ]
        };
        agent.add(
          new Payload("DIALOGFLOW_MESSENGER", payload, {
            rawPayload: true,
            sendAsMessage: true,
          })
        );
        console.error("queryGPT error:", error.message || error);
      }
    }

    let intentMap = new Map();
    intentMap.set("Default Welcome Intent", hi);
    intentMap.set("Default Fallback Intent", queryGPT);
    intentMap.set("QuoteSimulator", quoteSimulator);
    intentMap.set("QuoteSimulator - CollectLead", collectLead);
    intentMap.set("ReportIssue", reportIssue);
    intentMap.set("ReportIssue - Details", reportIssueDetails);

    await agent.handleRequest(intentMap);

    history.push({ userQuery: agent.query, response: agent.consoleMessages, intent: agent.intent });
    sessionHistory.set(sessionId, history);
    res.status(200).send();
  } catch (error) {
    console.error("Webhook error at", new Date().toISOString(), "Error:", error);
    res.status(500).send("Internal Server Error");
  }
});

// Test Google Sheets connection on server start
// testGoogleSheetConnection(); // Uncomment after confirming GOOGLE_SHEET_URL

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT} at`, new Date().toISOString());
});
