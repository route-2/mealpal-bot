import { Telegraf } from "telegraf";
import fetch from "node-fetch";
import dotenv from "dotenv";
import { SpeechClient } from "@google-cloud/speech";
import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
dotenv.config();

// Initialize the Telegram bot
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

const speechClient = new SpeechClient();

// // Handle voice messages
// bot.on('voice', async (ctx) => {
//     const file_id = ctx.message.voice.file_id;

//     // Get the file link for the voice message
//     const fileUrl = await ctx.telegram.getFileLink(file_id);

//     // Fetch the audio file as a buffer (in-memory)
//     const res = await fetch(fileUrl);
//     const audioBuffer = await res.buffer();  // Get audio as buffer

//     // Prepare the audio for Google Speech-to-Text
//     const audio = {
//         content: audioBuffer.toString('base64'),  // Convert the buffer to base64 encoding
//     };

//     const config = {
//         encoding: 'OGG_OPUS',  // Specify the audio format
//         sampleRateHertz: 16000, // Adjust if necessary based on your audio sample rate
//         languageCode: 'en-US',  // Change based on your language preference
//     };

//     const request = {
//         audio: audio,
//         config: config,
//     };

//     try {
//         // Recognize speech from the audio buffer
//         const [response] = await speechClient.recognize(request);
//         const transcript = response.results
//             .map(result => result.alternatives[0].transcript)
//             .join('\n');

//         console.log('Transcription:', transcript);

//         // Send the transcription back to the user
//         ctx.reply(`Transcription: ${transcript}`);
//     } catch (err) {
//         console.error('Error transcribing the voice message:', err);
//         ctx.reply('Sorry, there was an error processing the voice message.');
//     }
// });

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

bot.start((ctx) => {
  const chatId = ctx.chat.id;
  userState[chatId] = {}; // Initialize state for the user
  ctx.reply("Welcome! Let's start by selecting your diet option.", {
    reply_markup: {
      keyboard: [dietOptions],
      one_time_keyboard: true,
    },
  });
});

// Function to reset state for a new user
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
  };
};
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

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: "You are a helpful meal planning assistant.",
          },
          {
            role: "user",
            content: `Create a meal plan with calories for a ${dietPreference.toLowerCase()} diet to ${subGoal.toLowerCase()} weight, strictly adhering to a ${foodPreference.toLowerCase()} preference and include ${cuisinePreference}. Use these ingredients: ${includeIngredients}. Provide exactly 6 options for breakfast, lunch, and dinner without including any additional information.`,
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

async function getKrogerAccessToken(chatId) {
  try {
    const response = await axios.get(`${API_BASE_URL}/get-tokens`, {
      params: { chatId },
    });

    if (response.data.access_token) {
      console.log("Access Token:", response.data.access_token);
      return response.data.access_token; // Return the access token
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

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
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
async function handlePlaceOrder(chatId) {
  try {
    // 1) Check if user has a Kroger token in NestJS
    // Requires a GET /auth/kroger/get-token?chatId=... endpoint
    const response = await fetch(
      `http://localhost:3001/auth/kroger/get-token?chatId=${chatId}`
    );

    if (response.status === 404) {
      // Not logged in -> prompt them to login
      const loginUrl = `http://localhost:3001/auth/kroger/login?state=${chatId}`;
      await bot.telegram.sendMessage(
        chatId,
        `Please log in to Kroger first:\n${loginUrl}\n\nAfter you log in, come back and type "Place order" again.`
      );
      return;
    } else if (!response.ok) {
      // Other error
      await bot.telegram.sendMessage(chatId, "Error checking Kroger token.");
      return;
    }

    // 2) If we do have a token, proceed to place the order
    const data = await response.json();
    const userToken = data.access_token;

    // Here, you'd do "search for product," "nearest location," "cart add," etc.
    // For demo, let's just say "Order placed!"
    await bot.telegram.sendMessage(chatId, "Order placed (stub)!");
  } catch (error) {
    console.error("Error in handlePlaceOrder:", error);
    await bot.telegram.sendMessage(
      chatId,
      "Error placing order. Please try again later."
    );
  }
  await bot.telegram.sendMessage(chatId, "Order placed (stub)!");
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
        "Do you have any allergies or dietary restrictions or anything else you'd like to mention? (yes/no)",
        {
          reply_markup: { remove_keyboard: true },
        }
      );
    } else {
      await ctx.reply("Please provide a valid numeric budget.");
    }
  } else if (userMessage.toLowerCase() === "yes" && !state.includeIngredients) {
    await ctx.reply(
      "Please specify your allergies or ingredients to avoid or include or calorie intake"
    );
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
