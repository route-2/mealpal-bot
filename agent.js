import { Telegraf } from "telegraf";
import Redis from "ioredis";
import { v4 as uuidv4 } from "uuid";
import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const redis = new Redis();
const BASE_URL = "https://api.deepseek.com";
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

// Enhanced Agent Base Class with proper connection handling
class Agent {
  constructor(name) {
    this.id = uuidv4();
    this.name = name;
    this.subscriber = new Redis();
    this.publisher = new Redis();
  }

  async publish(topic, message) {
    await this.publisher.xadd(topic, "*", "message", JSON.stringify(message));
  }

  subscribe(topic, handler) {
    this.subscriber.subscribe(topic, (err) => {
      if (err) {
        console.error(`[${this.name}] Subscription error:`, err);
        return;
      }
      console.log(`[${this.name}] Subscribed to ${topic}`);
    });

    this.subscriber.on("message", (chan, msg) => {
      try {
        const parsed = JSON.parse(msg);
        console.log(`[${this.name}] Received message on ${chan}`);
        handler(parsed);
      } catch (error) {
        console.error(`[${this.name}] Message handling error:`, error);
      }
    });
  }
}

// State Management Agent with proper error handling
class UserStateAgent extends Agent {
  constructor() {
    super("user-state");
    this.subscribe("user-events", this.handleEvent.bind(this));
    this.subscribe("state-updated", this.handleStateUpdate.bind(this));
  }

  async handleEvent(message) {
    try {
      console.log(`[UserState] Handling event: ${message.event}`);
      const currentState = await this.getState(message.chatId);
      const newState = this.stateReducer(currentState, message.event, message.data);
      
      await redis.set(`user:${message.chatId}:state`, JSON.stringify(newState));
      this.publish("state-updated", {
        chatId: message.chatId,
        state: newState
      });
    } catch (error) {
      console.error(`[UserState] Error handling event:`, error);
      this.publish("error", { 
        chatId: message.chatId,
        error: error.message 
      });
    }
  }

  async handleStateUpdate(message) {
    try {
      console.log(`[UserState] State updated for ${message.chatId}`);
      if (message.state.location && !message.state.diet) {
        await bot.telegram.sendMessage(message.chatId, "Now select your diet option:", {
          reply_markup: {
            keyboard: [
              ["Gaining Weight", "Losing Weight"],
              ["PCOD Diet", "IBS Diet"]
            ],
            one_time_keyboard: true
          }
        });
      }
    } catch (error) {
      console.error(`[UserState] State update error:`, error);
    }
  }

  async getState(chatId) {
    const state = await redis.get(`user:${chatId}:state`);
    return state ? JSON.parse(state) : {};
  }

  stateReducer(state, event, data) {
    switch(event) {
      case "SESSION_START":
        return { ...state, status: "active" };
      case "LOCATION_SET":
        return { ...state, location: data };
      case "DIET_SELECTED":
        return { ...state, diet: data };
      default:
        return state;
    }
  }
}

// Meal Planning Agent with enhanced validation
class MealPlanningAgent extends Agent {
  constructor() {
    super("meal-planning");
    this.subscribe("plan-request", this.handleRequest.bind(this));
  }

  async handleRequest(message) {
    try {
      console.log(`[MealPlanning] Handling request for ${message.chatId}`);
      const state = await redis.get(`user:${message.chatId}:state`);
      
      if (!state) {
        await bot.telegram.sendMessage(message.chatId, "❌ Session expired. Please start over.");
        return;
      }

      const userState = JSON.parse(state);
      
      if (!this.validateState(userState)) {
        await bot.telegram.sendMessage(message.chatId, "⚠️ Please complete all steps first.");
        return;
      }

      const plan = await this.generatePlan(userState);
      await bot.telegram.sendMessage(message.chatId, `🍽️ Here’s your meal plan:\n\n${plan}`);
      this.publish("grocery-request", { chatId: message.chatId, plan });
    } catch (error) {
      console.error(`[MealPlanning] Error:`, error);
      await bot.telegram.sendMessage(message.chatId, "❌ Error generating meal plan. Please try again.");
    }
  }

  validateState(state) {
    return !!state.location && !!state.diet;
  }

  async generatePlan(state) {
    const response = await axios.post(`${BASE_URL}/v1/chat/completions`, {
      messages: [{
        role: "user",
        content: `Create a detailed meal plan for ${state.diet} diet in ${state.location.latitude},${state.location.longitude}`
      }]
    }, {
      headers: { 
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
        "Content-Type": "application/json"
      }
    });

    return response.data.choices[0].message.content;
  }
}

// Initialize Agents
const userStateAgent = new UserStateAgent();
const mealPlanningAgent = new MealPlanningAgent();

// Telegram Handlers with proper sequencing
bot.start(async (ctx) => {
  try {
    const chatId = ctx.chat.id;
    console.log(`Starting session for ${chatId}`);
    
    await userStateAgent.publish("user-events", {
      chatId,
      event: "SESSION_START",
      data: { timestamp: Date.now() }
    });
    
    await ctx.reply("Welcome to Meal Planner! 🍴\nPlease share your location:", {
      reply_markup: {
        keyboard: [[{ 
          text: "📍 Share Location", 
          request_location: true 
        }]],
        resize_keyboard: true,
        one_time_keyboard: true
      }
    });
  } catch (error) {
    console.error("Start command error:", error);
  }
});

bot.on("location", async (ctx) => {
  try {
    const chatId = ctx.chat.id;
    console.log(`Received location from ${chatId}`);
    
    await userStateAgent.publish("user-events", {
      chatId,
      event: "LOCATION_SET",
      data: ctx.message.location
    });
  } catch (error) {
    console.error("Location handling error:", error);
  }
});

bot.on("text", async (ctx) => {
  try {
    const chatId = ctx.chat.id;
    const text = ctx.message.text;
    console.log(`Received text from ${chatId}: ${text}`);

    await userStateAgent.publish("user-events", {
      chatId,
      event: "DIET_SELECTED",
      data: text
    });

    await mealPlanningAgent.publish("plan-request", { chatId });
  } catch (error) {
    console.error("Text handling error:", error);
  }
});

// Error Handling
redis.on("error", (err) => {
  console.error("Redis error:", err);
});

bot.catch((err) => {
  console.error("Bot error:", err);
});

// Startup
bot.launch().then(() => {
  console.log("🚀 Bot started successfully");
}).catch(err => {
  console.error("Bot launch failed:", err);
});

// Cleanup
process.on("SIGINT", async () => {
  console.log("Shutting down...");
  await bot.stop();
  redis.disconnect();
  process.exit();
});