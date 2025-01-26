import { Telegraf } from "telegraf";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config(); // Load environment variables

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Initialize OpenAI client for DeepSeek API
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY
const BASE_URL = "https://api.deepseek.com";

// Function to get meal plan
async function generateMealPlan(chatId) {
  try {
    const response = await axios.post(
      `${BASE_URL}/v1/chat/completions`,
      {
        model: "deepseek-chat",
        messages: [
          {
            role: "system",
            content:
              "You are a professional nutritionist and meal planner.",
          },
          {
            role: "user",
            content:
              "Generate a structured meal plan for a vegetarian diet focused on cutting weight while maintaining energy levels. The cuisine preferences should be Indian and American.",
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const mealPlan = response.data.choices[0].message.content;
    await bot.telegram.sendMessage(chatId, `🍽 **Meal Plan**:\n\n${mealPlan}`);

    return mealPlan;
  } catch (error) {
    console.error("Error fetching meal plan:", error);
    await bot.telegram.sendMessage(
      chatId,
      "❌ Sorry, I couldn't generate the meal plan. Please try again."
    );
  }
}

// Function to get grocery list
async function generateGroceryList(chatId, mealPlan) {
  try {
    const response = await axios.post(
      `${BASE_URL}/v1/chat/completions`,
      {
        model: "deepseek-chat",
        messages: [
          {
            role: "system",
            content: `
            Generate a **structured grocery list** for the following meal plan: ${mealPlan}.
            
            **Rules:**
            - ✅ **Provide ingredient names with numbers only** (NO grams, cups, kg, liters, etc.).
            - ✅ **Merge duplicates** (each item should appear only once).
            - ❌ **No meal categories (breakfast, lunch, etc.)**.
            - ❌ **No calorie counts**.
            - ❌ **Remove descriptors like minced, chopped, diced, shredded**.

            **Expected format:**
            - Milk: 1  
            - Eggs: 12  
            - Paneer: 1  
            - Quinoa: 1  
            - Broccoli: 2  
            - Almonds: 1  
            `,
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const groceryList = response.data.choices[0].message.content;
    await bot.telegram.sendMessage(chatId, `🛒 **Grocery List**:\n\n${groceryList}`);
  } catch (error) {
    console.error("Error fetching grocery list:", error);
    await bot.telegram.sendMessage(
      chatId,
      "❌ Sorry, I couldn't generate the grocery list. Please try again."
    );
  }
}

// Handle `/mealplan` command
bot.command("mealplan", async (ctx) => {
  const chatId = ctx.chat.id;
  const mealPlan = await generateMealPlan(chatId);
  if (mealPlan) {
    await bot.telegram.sendMessage(
      chatId,
      "Would you like a grocery list for this meal plan? Reply with **Yes** or **No**."
    );
  }
});

// Handle user response for grocery list
bot.on("text", async (ctx) => {
  const chatId = ctx.chat.id;
  const userMessage = ctx.message.text.toLowerCase();

  if (userMessage === "yes") {
    await generateGroceryList(chatId, "latest meal plan"); // You need to store the last meal plan dynamically
  } else if (userMessage === "no") {
    await bot.telegram.sendMessage(chatId, "Alright! Let me know if you need anything else.");
  }
});

// Start bot
bot.launch();
console.log("🤖 Telegram bot is running...");
