
import { Telegraf } from "telegraf";
import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

// Initialize the Telegram bot
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Define options
const dietOptions = [
  "Gaining Weight",
  "Losing Weight",
  "PCOD (Polycystic Ovarian Disease) Diet",
  "IBS (Irritable Bowel Syndrome) Diet",
];
const subgoalOptions = ["Bulk", "Cut"];
const preferenceOptions = ["Veg", "Non-Veg", "Vegan", "Pescatarian", "Custom"];

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
  };
};
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
  if (!user || !user.dietPreference || !user.subGoal || !user.foodPreference) {
    await bot.telegram.sendMessage(
      chatId,
      "Please complete all steps before generating a meal plan."
    );
    return;
  }

  const { dietPreference, subGoal, includeIngredients, foodPreference } = user;

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
            content: `Create a meal plan for a ${dietPreference.toLowerCase()} diet to ${subGoal.toLowerCase()} weight and keep ${foodPreference} in mind strictly. Include these ingredients: ${
              includeIngredients || "none"
            }. Provide 6 options for breakfast, lunch, and dinner.`,
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
            content: "You are a grocery list assistant.",
          },
          {
            role: "user",
            content: `Generate a structured human-readable grocery list for the following meal plan: ${JSON.stringify(
              mealPlan
            )}. For each ingredient, include only "ingredient" and "quantity" in the format:
  ingredient: quantity round up to whole number only
  ingredient: quantity round up to whole number number only
  For example:
  Eggs: 12
  Milk: 1 
  Do not include sections like breakfast, lunch, or dinner. Only list the main whole ingredients with their quantities. Add up duplicates and show once dont show the same ingredient twice.`,
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
  } catch (error) {
    console.error("Error generating grocery list:", error);
    await bot.telegram.sendMessage(
      chatId,
      "Something went wrong. Please try again."
    );
  }
};

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
    state.preferenceOptions = userMessage;

    if (userMessage === "Custom") {
      await ctx.reply(
        "Please describe your custom diet preferences or restrictions."
      );
    } else {
      await ctx.reply(
        "Do you have any allergies or dietary restrictions? (yes/no)",
        {
          reply_markup: { remove_keyboard: true },
        }
      );
    }
  } else if (userMessage.toLowerCase() === "yes") {
    await ctx.reply("Please specify your allergies or ingredients to avoid.");
  } else if (userMessage.toLowerCase() === "no") {
    await handleGenerateMealPlan(chatId);
  } else if (!state.includeIngredients) {
    state.includeIngredients = userMessage;
    await handleGenerateMealPlan(chatId);
  } else {
    await ctx.reply("I did not understand that. Please try again.");
  }

  if (state?.waitingForGroceryListResponse) {
    // Call handleUserResponse and clear the state
    await handleUserResponse(chatId, userMessage);
    userState[chatId].waitingForGroceryListResponse = false; // Reset state
    return;
  }
});

// Start the bot
bot.launch();
