import { Telegraf } from "telegraf";
import fetch from "node-fetch";
import dotenv from "dotenv";
import Redis from "ioredis";

import { SpeechClient } from "@google-cloud/speech";
import schedule from "node-schedule";
import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
dotenv.config();

// Initialize the Telegram bot
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

const speechClient = new SpeechClient();
const redis = new Redis();

// Initialize OpenAI client for DeepSeek API
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY
const BASE_URL = "https://api.deepseek.com";

redis.on("connect", () => {
  console.log("Redis connected successfully.");
});

redis.on("error", (err) => {
  console.error("Redis connection error:", err);
});

// Define options
const dietOptions = [
  "Gaining Weight",
  "Losing Weight",
  "PCOD (Polycystic Ovarian Disease) Diet",
  "IBS (Irritable Bowel Syndrome) Diet",
];
const subgoalOptions = ["Bulk", "Cut"];
const preferenceOptions = ["Veg", "Non-Veg", "Vegan", "Pescatarian"];
const lifestyleOptions = [
  "Gluten-Free",
  "Dairy-Free",
  "Keto",
  "Paleo",
  "Halal",
  "Kosher",
  "Raw Food",
  "Organic",
  "Whole30",
  "Intermittent Fasting",
  "FODMAP",
];

const cuisineOptions = [
  "Indian",
  "Italian",
  "Chinese",
  "Mexican",
  "American",
  "Thai",
  "Japanese",
  "Mediterranean",
  "French",
  "Korean",
  "Greek",
  "Vietnamese",
  "Spanish",
  "Middle Eastern",
  "Caribbean",
  "African",
  "German",
  "Turkish",
  "Russian",
  "Australian",
];

// Variables to store user inputs

let mealPlan = {};
let groceryList = [];

const userState = {}; // Ensure this is defined at the top of your file
const resetUserState = (chatId) => {
    userState[chatId] = {
      dietPreference: "",
      subGoal: "",
      foodPreference: "",
      includeIngredients: "",
      foodPreference: "",
      preferenceOptions: "",
      cuisinePreference: "",
      selectedCuisines: [],
      budget: null,
      waitingForGroceryListResponse: false,
      waitingForPlaceOrderResponse: false,
      location: null,
      awaitingLocation : true,
    };
  };

// Modified start command with debug logging
bot.start(async (ctx) => {
    try {
        const chatId = ctx.chat.id;
        resetUserState(chatId); // Now properly initializes state
        console.log("Reset state:", userState[chatId]); // Add this debug line
        
        await ctx.reply("Welcome! Please share location...");
      const message = await ctx.reply("Please share your location:", {
        reply_markup: {
          keyboard: [[{
            text: "📍 Share Location",
            request_location: true
          }]],
          one_time_keyboard: true,
          resize_keyboard: true
        }
      });
      console.log(`Location request message ID: ${message.message_id}`);
      
    } catch (error) {
      console.error("Error in start command:", error);
    }
  });
  
  // Enhanced location handler with debugging
  bot.on('location', async (ctx) => {
    const chatId = ctx.chat.id;
    console.log(`Location received from ${chatId}`);
    
    try {
      const state = userState[chatId];
      console.log(`User state before processing: ${JSON.stringify(state)}`);
      
      if (!state?.awaitingLocation) {
        console.log(`Ignoring location from ${chatId} - not awaiting location`);
        return;
      }
  
      // Validate location structure
      if (!ctx.message?.location) {
        console.log(`Invalid location format from ${chatId}`);
        await ctx.reply("Invalid location format. Please try again.");
        return;
      }
  
      const { latitude, longitude } = ctx.message.location;
      console.log(`Raw coordinates: ${latitude},${longitude}`);
  
      // Add User-Agent header for Nominatim compliance
      const headers = {
        'User-Agent': 'MealPlannerBot/1.0 (contact@example.com)'
      };
  
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=10`,
        { headers }
      );
      
      console.log(`Geocoding response status: ${response.status}`);
      const data = await response.json();
      console.log(`Geocoding response data: ${JSON.stringify(data)}`);
  
      if (!data.address) {
        console.log(`No address found for coordinates ${latitude},${longitude}`);
        await ctx.reply("Couldn't determine location. Please try again.");
        return;
      }
  
      // Store formatted location in Redis
      const locationData = {
        coordinates: { lat: latitude, lon: longitude },
        address: {
          city: data.address.city || data.address.town || data.address.village,
          region: data.address.state,
          country: data.address.country,
          country_code: data.address.country_code
        }
      };
      
      console.log(`Storing location for ${chatId}: ${JSON.stringify(locationData)}`);
      await redis.setex(`user:${chatId}:location`, 86400, JSON.stringify(locationData));
  
      // Update user state
      userState[chatId] = {
        ...state,
        location: locationData,
        awaitingLocation: false
      };
  
      console.log(`Updated user state: ${JSON.stringify(userState[chatId])}`);
      
      // Proceed to diet selection
      await ctx.reply(`Thanks! Detected location: ${locationData.address.city}, ${locationData.address.country}`);
      await ctx.reply("Now select your diet option:", {
        reply_markup: {
          keyboard: [dietOptions],
          one_time_keyboard: true,
        }
      });
  
    } catch (error) {
      console.error("Location processing error:", error);
      await ctx.reply("Couldn't process location. Please try again.");
      // Send error details to developer
      await bot.telegram.sendMessage(
        process.env.ADMIN_CHAT_ID, 
        `Location error from ${chatId}: ${error.message}`
      );
    }
  });
// Function to reset state for a new user

const API_BASE_URL = "https://265c-192-5-91-93.ngrok-free.app/auth/kroger";
const parseMealPlan = (content) => {
  const mealPlan = {};
  const sections = content.split("\n\n");

  sections.forEach((section) => {
    const lines = section.split("\n");
    const title = lines[0]?.replace("**", "").replace(":", "").trim();
    if (
      title &&
      ["Breakfast", "Lunch", "Dinner"].some((meal) => title.includes(meal))
    ) {
      const options = lines
        .slice(1)
        .map((line) => line.replace(/^- /, "").trim())
        .filter(Boolean);
      mealPlan[title] = options;
    }
  });
};
const handleGenerateMealPlan = async (chatId) => {
  const user = userState[chatId];
  if (
    !user ||
    !user.dietPreference ||
    !user.subGoal ||
    !user.foodPreference ||
    !user.cuisinePreference
  ) {
    await bot.telegram.sendMessage(
      chatId,
      "Please complete all steps before generating a meal plan."
    );
    return;
  }

  const {
    dietPreference,
    subGoal,
    includeIngredients,
    foodPreference,
    cuisinePreference,
    selectedCuisines,
  } = user;

  try {
    await bot.telegram.sendMessage(
      chatId,
      "Generating a meal plan with your preferences..."
    );

    const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          {
            role: "system",
            content: "You are a helpful meal planning assistant.",
          },
          {
            role: "user",
            content: `Create a meal plan with CALORIES for a ${dietPreference.toLowerCase()} diet to ${subGoal.toLowerCase()} weight, strictly adhering to a ${foodPreference.toLowerCase()} preference and include ${cuisinePreference}. exclude these ingredients striclty: ${includeIngredients}. Provide exactly 6 options for breakfast, lunch, and dinner without including any additional information.`,
          },
        ],
      }),
    });

    const data = await response.json();
    console.log("Full API response:", data);

    if (
      !data.choices ||
      !data.choices[0] ||
      !data.choices[0].message ||
      !data.choices[0].message.content
    ) {
      console.error("Invalid API response structure:", data);
      await bot.telegram.sendMessage(
        chatId,
        "Failed to retrieve a valid meal plan. Please try again later."
      );
      return;
    }

    const assistantMessage = data.choices[0].message.content;

    await bot.telegram.sendMessage(
      chatId,
      `Here’s your meal plan:\n\n${assistantMessage}`
    );
    mealPlan = assistantMessage;
    await bot.telegram.sendMessage(
      chatId,
      "Would you like a grocery list? Reply with 'Yes' or 'No'."
    );
    userState[chatId] = {
      ...userState[chatId],
      waitingForGroceryListResponse: true,
    }; // Update state
  } catch (error) {
    console.error("Error generating meal plan:", error);
    await bot.telegram.sendMessage(
      chatId,
      "Something went wrong while generating your meal plan."
    );
  }
};
const refreshTokensCronJob = async () => {
  try {
    // Fetch all users with tokens stored in Redis
    const keys = await redis.keys("kroger_tokens:*");

    for (const key of keys) {
      const chatId = key.split(":")[1];
      const tokenData = JSON.parse(await redis.get(key));

      if (tokenData && tokenData.refresh_token) {
        console.log(`Refreshing token for chat ID: ${chatId}`);

        try {
          // Refresh the access token
          const response = await axios.post(
            "https://api.kroger.com/v1/connect/oauth2/token",
            new URLSearchParams({
              client_id: process.env.KROGER_CLIENT_ID,
              client_secret: process.env.KROGER_CLIENT_SECRET,
              grant_type: "refresh_token",
              refresh_token: tokenData.refresh_token,
            }).toString(),
            {
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
            }
          );

          const { access_token, refresh_token, expires_in } = response.data;

          // Save the updated tokens
          await redis.set(
            key,
            JSON.stringify({ access_token, refresh_token, expires_in }),
            "EX",
            expires_in // Set TTL to match expiration
          );

          console.log(`Refreshed token for chat ID ${chatId}`);
        } catch (err) {
          console.error(
            `Error refreshing token for chat ID ${chatId}:`,
            err.message
          );
        }
      }
    }
  } catch (err) {
    console.error("Error running token refresh job:", err.message);
  }
};
schedule.scheduleJob("*/15 * * * *", refreshTokensCronJob);

async function getKrogerAccessToken(chatId) {
  try {
    const tokenData = JSON.parse(await redis.get(`kroger_tokens:${chatId}`));

    if (tokenData && tokenData.access_token) {
      console.log("Access Token:", tokenData.access_token);
      return tokenData.access_token; // Return the access token
    } else {
      console.log("No tokens found for this user.");
      return null;
    }
  } catch (error) {
    console.error("Error fetching Kroger tokens:", error.message);
    return null;
  }
}

bot.command("get_kroger_token", async (ctx) => {
  const chatId = ctx.chat.id;

  const accessToken = await getKrogerAccessToken(chatId);

  if (accessToken) {
    ctx.reply(`✅ Your Kroger access token is: ${accessToken}`);
  } else {
    ctx.reply("⚠️ You are not authenticated with Kroger. Please log in first.");
  }
});

const handleGenerateGroceryList = async (chatId) => {
  if (!mealPlan || Object.keys(mealPlan).length === 0) {
    await bot.telegram.sendMessage(
      chatId,
      "Please generate a meal plan first."
    );
    return;
  }

  try {
    await bot.telegram.sendMessage(chatId, "Generating your grocery list...");

    const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          {
            role: "system",
            content: `
            Generate a structured human-readable grocery list for the following meal plan: ${JSON.stringify(
              mealPlan
            )}. For each ingredient, include only "ingredient" and "quantity" in the format:
            ingredient: quantity round up to whole number only
            ingredient: quantity round up to whole number number only
            strictly follow format:
            Eggs: 12
            Milk: 1 
            Do not include sections like breakfast, lunch, or dinner.dont show calories. remove unnecessary words like "minced",
      "chopped",
      "sliced",
      "diced",
      "shredded",
      "toasted",
      "grated",
      "peeled",
      "seeded",
      "cut",
      "thinly",
      "to taste"
      "freshly","roasted","baked","steamed","toast", "grilled","smoked","vegetables", "cooked",etc. Only list the main whole ingredients with their quantities. Add up duplicates and show once dont show the same ingredient twice.`,
          },
        ],
      }),
    });

    const data = await response.json();
    const groceryList = data.choices?.[0]?.message?.content;

    if (!groceryList) {
      throw new Error("Invalid response from OpenAI API.");
    }

    await bot.telegram.sendMessage(
      chatId,
      `Here's your grocery list:\n\n${groceryList}`
    );
    await bot.telegram.sendMessage(
      chatId,
      "Would you like to Place Order? Reply with 'Yes' or 'No'"
    );
    userState[chatId].waitingForPlaceOrderResponse = true;
  } catch (error) {
    console.error("Error generating grocery list:", error);
    await bot.telegram.sendMessage(
      chatId,
      "Something went wrong. Please try again."
    );
  }
};
// const response = await fetch("https://api.openai.com/v1/chat/completions", {
//     method: "POST",
//     headers: {
//       "Content-Type": "application/json",
//       Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
//     },
//     body: JSON.stringify({
//       model: "gpt-4-turbo",  // ✅ Use the latest model with vision capabilities
//       messages: [
//         {
//           role: "system",
//           content: "Analyze the following image and list the food items visible in the fridge. Then generate a structured grocery list based on the available ingredients.",
//         },
//         {
//           role: "user",
//           content: [
//             { type: "text", text: "What food items do you see in this image? Generate a grocery list based on them." },
//             { type: "image_url", image_url: { url: "https://hips.hearstapps.com/hmg-prod/images/refrigerator-full-of-food-royalty-free-image-1596641208.jpg?crop=0.778xw:1.00xh;0.107xw,0&resize=1200:*" } }
//           ],
//         }
//       ],
//       max_tokens: 500
//     }),
//   });

//   const data = await response.json();
//   console.log(data.choices[0].message.content),"image";

// Function to send image to OpenAI's GPT-4 Vision
async function analyzeImage(imageUrl) {
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4-turbo",
        messages: [
          {
            role: "system",
            content:
              "Analyze the following image and list the food items visible in the fridge. Then generate a structured grocery list based on the available ingredients.",
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "What food items do you see in this image? Generate a grocery list based on them.",
              },
              { type: "image_url", image_url: { url: imageUrl } },
            ],
          },
        ],
        max_tokens: 500,
      }),
    });

    const data = await response.json();

    if (data.error) {
      console.error("OpenAI Error:", data.error);
      return "⚠️ Error analyzing image. Please try again later.";
    }

    return data.choices[0].message.content;
  } catch (error) {
    console.error("Error:", error);
    return "⚠️ Something went wrong. Please try again.";
  }
}

// Telegram bot listener for images
bot.on("photo", async (ctx) => {
  try {
    // Get the file ID of the largest available photo
    const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;

    // Get the direct image link from Telegram
    const fileLink = await ctx.telegram.getFileLink(fileId);
    console.log("Received image URL:", fileLink);

    // Send the image URL to OpenAI for analysis
    const result = await analyzeImage(fileLink);

    // Send the response back to the user
    await ctx.reply(result);
  } catch (error) {
    console.error("Error handling image upload:", error);
    await ctx.reply("⚠️ Unable to process the image. Please try again.");
  }
});

async function handlePlaceOrder(chatId) {
  try {
    const userToken = await getKrogerAccessToken(chatId);

    if (!userToken) {
      // User is not logged in, prompt them to log in
      const loginUrl = `http://localhost:3001/auth/kroger/login?state=${chatId}`;
      await bot.telegram.sendMessage(
        chatId,
        `Please log in to Kroger first:\n${loginUrl}\n\nAfter you log in, come back and type "Place order" again.`
      );
      return;
    }

    // Use the access token for Kroger API calls
    console.log(`Placing order with token: ${userToken}`);
    await bot.telegram.sendMessage(chatId, "Order placed (stub)!");
  } catch (error) {
    console.error("Error in handlePlaceOrder:", error);
    await bot.telegram.sendMessage(
      chatId,
      "Error placing order. Please try again later."
    );
  }
}

// Handle user response for grocery list
const handleUserResponse = async (chatId, userResponse) => {
  if (userResponse.trim().toLowerCase() === "yes") {
    await handleGenerateGroceryList(chatId);
  } else if (userResponse.trim().toLowerCase() === "no") {
    await bot.telegram.sendMessage(
      chatId,
      "Okay! Let me know if you need anything else."
    );
  } else {
    await bot.telegram.sendMessage(chatId, "Please reply with 'Yes' or 'No'.");
  }
};

// Bot handlers
bot.start((ctx) => {
  const chatId = ctx.chat.id;
  resetUserState(chatId);
  ctx.reply("Welcome! Let's start by selecting your diet option.", {
    reply_markup: {
      keyboard: dietOptions.map((option) => [option]),
      one_time_keyboard: true,
    },
  });
});

bot.command("place_order", async (ctx) => {
  const chatId = ctx.chat.id;

  try {
    // Fetch the access token from Redis
    const userToken = await getKrogerAccessToken(chatId);

    if (!userToken) {
      // If no token is found, prompt the user to log in
      const loginUrl = `https://265c-192-5-91-93.ngrok-free.app/auth/kroger/login?state=${chatId}`;
      await ctx.reply(
        `⚠️ You are not authenticated with Kroger. Please log in first:\n\n${loginUrl}`
      );
      return;
    }

    // If token exists, simulate order placement
    await ctx.reply("✅ Token found! Placing your order...");

    // Simulated order placement logic
    console.log(`Placing order for chat ID ${chatId} with token: ${userToken}`);
    await ctx.reply("🎉 Your order has been placed successfully!");
  } catch (error) {
    console.error("Error during order placement:", error.message);
    await ctx.reply("❌ Something went wrong. Please try again later.");
  }
});

bot.on("text", async (ctx) => {
  const chatId = ctx.chat.id;
  const userMessage = ctx.message.text;

  if (!userState[chatId]) resetUserState(chatId);

  const state = userState[chatId];
  if (state?.waitingForGroceryListResponse) {
    await handleUserResponse(chatId, userMessage);
    userState[chatId].waitingForGroceryListResponse = false;
    return;
  }
  if (state.waitingForPlaceOrderResponse) {
    if (userMessage.trim().toLowerCase() === "yes") {
      // The user wants to place the order
      const loginUrl =
        `https://265c-192-5-91-93.ngrok-free.app/auth/kroger/login?state=${chatId}`.trim();

      await ctx.reply("Please tap the button below to log in to Kroger:", {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "Log in to Kroger",
                url: loginUrl,
              },
            ],
          ],
        },
      });
      state.waitingForPlaceOrderResponse = false;
      return;
      await handlePlaceOrder(chatId);
    } else if (userMessage.trim().toLowerCase() === "no") {
      await ctx.reply("Okay, order cancelled.");
    } else {
      await ctx.reply("Please reply with 'Yes' or 'No'.");
    }
    // Reset the flag
    state.waitingForPlaceOrderResponse = false;
    return;
  }

  if (!state.dietPreference && dietOptions.includes(userMessage)) {
    state.dietPreference = userMessage;
    await ctx.reply("Now, please select your subgoal.", {
      reply_markup: {
        keyboard: subgoalOptions.map((option) => [option]),
        one_time_keyboard: true,
      },
    });
  } else if (!state.subGoal && subgoalOptions.includes(userMessage)) {
    state.subGoal = userMessage;
    await ctx.reply("Now, please select your food preferences.", {
      reply_markup: {
        keyboard: preferenceOptions.map((option) => [option]),
        one_time_keyboard: true,
      },
    });
  } else if (!state.foodPreference && preferenceOptions.includes(userMessage)) {
    state.foodPreference = userMessage;

    // Proceed to cuisine selection
    state.selectedCuisines = []; // Initialize the cuisine selection list
    await ctx.reply("Please select one or more cuisines:", {
      reply_markup: {
        keyboard: cuisineOptions.map((option) => [option]),
        one_time_keyboard: false,
      },
    });
  } else if (!state.cuisinePreference && cuisineOptions.includes(userMessage)) {
    if (!state.selectedCuisines.includes(userMessage)) {
      state.selectedCuisines.push(userMessage);
    }

    await ctx.reply(
      ` You've selected: ${state.selectedCuisines.join(
        ", "
      )}. Would you like to select another cuisine? (yes/no)`,
      {
        reply_markup: {
          keyboard: [["Yes"], ["No"]],
          one_time_keyboard: true,
        },
      }
    );
  } else if (!state.cuisinePreference && userMessage.toLowerCase() === "yes") {
    await ctx.reply("Please select another cuisine:", {
      reply_markup: {
        keyboard: cuisineOptions.map((option) => [option]),
        one_time_keyboard: false,
      },
    });
  } else if (!state.cuisinePreference && userMessage.toLowerCase() === "no") {
    state.cuisinePreference =
      state.selectedCuisines.length > 0
        ? state.selectedCuisines
        : ["No specific preference"];
    // Ask for the budget now
    await ctx.reply(
      "Now, please provide your budget for the meal plan (in your preferred currency):"
    );
  } else if (!state.budget) {
    // Ensure the budget is a valid number
    const budget = parseFloat(userMessage);
    if (!isNaN(budget) && budget > 0) {
      state.budget = budget; // Save the budget
      await ctx.reply(`Got it! Your budget is ${state.budget}.`);

      // Proceed with allergies or dietary restrictions
      await ctx.reply(
        "Do you have any allergies or dietary restrictions? (yes/no)",
        {
          reply_markup: { remove_keyboard: true },
        }
      );
    } else {
      await ctx.reply("Please provide a valid numeric budget.");
    }
  } else if (userMessage.toLowerCase() === "yes" && !state.includeIngredients) {
    await ctx.reply("Please specify your allergies or ingredients to avoid");
  } else if (userMessage.toLowerCase() === "no" && !state.includeIngredients) {
    // Handle the case when no allergies are specified
    await handleGenerateMealPlan(chatId);
  } else if (!state.includeIngredients) {
    state.includeIngredients = userMessage; // Save allergies or restrictions input
    await handleGenerateMealPlan(chatId);
  } else {
    await ctx.reply("I did not understand that. Please try again.");
  }
});
// Start the bot
bot.launch();
