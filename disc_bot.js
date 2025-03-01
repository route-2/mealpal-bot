import {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  MessageFlags,
  ButtonStyle,
  StringSelectMenuBuilder,
} from "discord.js";
import dotenv from "dotenv";
import axios from "axios";
dotenv.config();

// Initialize Discord Bot
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
  ],
});

// User State
const userState = {};

// Reset User State
const resetUserState = (userId) => {
  userState[userId] = {
    awaitingLocation: true,
    location: null,
    latitude: null,
    longitude: null,
    dietPreference: "",
    subGoal: "",
    foodPreference: "",
    includeIngredients: "",
    cuisinePreference: "",
    selectedCuisines: [],
    budget: null,
    waitingForGroceryListResponse: false,
    waitingForPlaceOrderResponse: false,
  };
};

// Bot Ready
client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}!`);
});

// Handle !start Command - Send Diet Preference Buttons
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  const userId = message.author.id;
  const userMessage = message.content.trim().toLowerCase();

  if (!userState[userId]) resetUserState(userId);

  if (userMessage === "!start") {
    resetUserState(userId);

    // Create Buttons for Diet Selection
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("diet_gain_weight")
        .setLabel("Gaining Weight")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("diet_lose_weight")
        .setLabel("Losing Weight")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("diet_pcod")
        .setLabel("PCOD Diet")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("diet_ibs")
        .setLabel("IBS Diet")
        .setStyle(ButtonStyle.Secondary)
    );

    await message.reply({
      content: "Please select your diet preference:",
      components: [row],
    });
  }
});

// Handle User Button Clicks
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;
  const userId = interaction.user.id;

  if (!userState[userId]) resetUserState(userId);

  // Handle Diet Selection
  if (interaction.customId.startsWith("diet_")) {
    const selectedDiet = interaction.customId
      .replace("diet_", "")
      .replace("_", " ");
    userState[userId].dietPreference = selectedDiet;

    await interaction.reply({
      content: `✅ You selected: **${selectedDiet}**\nNow, choose your subgoal:`,
      flags: MessageFlags.Ephemeral,
    });

    // Send Subgoal Buttons
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("subgoal_bulk")
        .setLabel("Bulk")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("subgoal_cut")
        .setLabel("Cut")
        .setStyle(ButtonStyle.Danger)
    );

    await interaction.followUp({
      content: "Choose your subgoal:",
      components: [row],
    });
  }

  // Handle Subgoal Selection
  if (interaction.customId.startsWith("subgoal_")) {
    const selectedSubgoal = interaction.customId
      .replace("subgoal_", "")
      .replace("_", " ");
    userState[userId].subGoal = selectedSubgoal;

    await interaction.reply({
      content: `✅ You selected: **${selectedSubgoal}**\nNow, choose your food preference:`,
      ephemeral: true,
    });

    // Send Food Preference Select Menu
    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("food_preference")
        .setPlaceholder("Select your food preference")
        .addOptions([
          { label: "Veg", value: "veg" },
          { label: "Non-Veg", value: "non-veg" },
          { label: "Vegan", value: "vegan" },
          { label: "Pescatarian", value: "pescatarian" },
        ])
    );

    await interaction.followUp({
      content: "Select your food preference:",
      components: [row],
    });
  }
});

// Handle Select Menu Interactions
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isStringSelectMenu()) return;
  const userId = interaction.user.id;

  if (!userState[userId]) resetUserState(userId);

  // Handle Food Preference Selection
  if (interaction.customId === "food_preference") {
    userState[userId].foodPreference = interaction.values[0];

    await interaction.reply({
      content: `✅ You selected: **${interaction.values[0]}**\nNow, select your cuisine preferences (you can choose multiple):`,
      flags: MessageFlags.Ephemeral,
    });

    // ✅ Send Multi-Select Cuisine Menu
    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("cuisine_preference")
        .setPlaceholder("Select your preferred cuisines")
        .setMinValues(1)
        .setMaxValues(5)
        .addOptions([
          { label: "Indian", value: "Indian" },
          { label: "Italian", value: "Italian" },
          { label: "Mexican", value: "Mexican" },
          { label: "American", value: "American" },
          { label: "Chinese", value: "Chinese" },
          { label: "Japanese", value: "Japanese" },
          { label: "Thai", value: "Thai" },
          { label: "Mediterranean", value: "Mediterranean" },
          { label: "French", value: "French" },
          { label: "Korean", value: "Korean" },
          { label: "Vietnamese", value: "Vietnamese" },
          { label: "Greek", value: "Greek" },
        ])
    );

    await interaction.followUp({
      content: "Choose your cuisine preferences:",
      components: [row],
      flags: MessageFlags.Ephemeral,
    });

    userState[userId].awaitingCuisineSelection = true;
  }

  // Handle Multi-Select Cuisine Selection
  if (interaction.customId === "cuisine_preference") {
    userState[userId].selectedCuisines = interaction.values;

    await interaction.reply({
      content: `✅ You selected: **${interaction.values.join(
        ", "
      )}**\nNow, enter your budget:`,
      flags: MessageFlags.Ephemeral,
    });

    userState[userId].awaitingBudget = true;
  }
});

// Handle User Budget Input
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  const userId = message.author.id;
  const userMessage = message.content.trim();

  if (!userState[userId]) return;

  if (userState[userId].awaitingBudget) {
    const budget = parseFloat(userMessage);
    if (isNaN(budget) || budget <= 0) {
      await message.reply("⚠️ Please enter a valid number for your budget.");
      return;
    }

    userState[userId].budget = budget;
    userState[userId].awaitingBudget = false;

    await message.reply(
      `✅ Budget set to: **$${budget}**\nGenerating your meal plan...`
    );
    await handleGenerateMealPlan(userId, message);
  }
});
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  const userId = message.author.id;
  const userMessage = message.content.trim().toLowerCase();

  if (!userState[userId]) resetUserState(userId);

  if (userMessage === "!grocerylist") {
    await handleGenerateGroceryList(userId, message);
  } else if (
    userState[userId].waitingForGroceryListResponse &&
    userMessage === "yes"
  ) {
    await handleGenerateGroceryList(userId, message);
    userState[userId].waitingForGroceryListResponse = false;
  } else if (
    userState[userId].waitingForPlaceOrderResponse &&
    ["yes", "no"].includes(userMessage)
  ) {
    if (userMessage === "yes") {
      await message.reply("🛒 Placing your grocery order...");
      // TODO: Call Kroger API order function here
    } else {
      await message.reply(
        "✅ No worries! Let me know if you need anything else."
      );
    }
    userState[userId].waitingForPlaceOrderResponse = false;
  }
});

const handleGenerateGroceryList = async (userId, message) => {
  const user = userState[userId];

  if (!user?.mealPlan) {
    await message.reply(
      "⚠️ Please generate a meal plan first before requesting a grocery list."
    );
    return;
  }

  try {
    await message.reply("🔄 Generating your grocery list...");

    const response = await fetch("http://127.0.0.1:8000/groceries/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meal_plan: user.mealPlan }),
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error);
    }

    const groceryList = data.grocery_list;

    const messageChunks = groceryList.match(/.{1,2000}/g) || [];
    message.channel.send("🛍 **Grocery List:**\n");
    for (const chunk of messageChunks) {
      await message.channel.send(`${chunk}`);
    }

    await message.reply(
      "🛒 Would you like to place an order? Reply with 'Yes' or 'No'."
    );

    userState[userId].waitingForPlaceOrderResponse = true;
  } catch (error) {
    console.error("🚨 Error generating grocery list:", error);
    await message.reply(
      "⚠️ Failed to generate grocery list. Please try again later."
    );
  }
};

// Generate Meal Plan
async function handleGenerateMealPlan(userId, message) {
  const user = userState[userId];

  console.log("🔍 Preparing API request with:", JSON.stringify(user, null, 2));

  try {
    await message.reply("🔄 Generating your meal plan...");

    const response = await axios.post(
      "http://127.0.0.1:8000/meals/generate",
      {
        diet: user.dietPreference || "N/A",
        subGoal: user.subGoal || "N/A",
        foodPreference: user.foodPreference || "N/A",
        cuisinePreference: user.selectedCuisines || [],
        includeIngredients: user.includeIngredients
          ? user.includeIngredients
          : "",
        budget: user.budget || "No budget specified",
        ingredientsAtHome: user.ingredientsAtHome || "",
      },
      {
        headers: { "Content-Type": "application/json" },
      }
    );

    console.log(" API Response:", response.data);

    if (!response.data || response.data.error) {
      await message.reply(
        "❌ Failed to generate meal plan. Please try again later."
      );
      return;
    }
    userState[userId].mealPlan = response.data.meal_plan;

    // Send Meal Plan
    const mealPlanChunks = response.data.meal_plan.match(/.{1,2000}/g) || [];
    for (const chunk of mealPlanChunks) {
      await message.channel.send(chunk);
    }

    await message.reply("Would you like a grocery list? (Yes/No)");
    userState[userId].waitingForGroceryListResponse = true;
  } catch (error) {
    console.error(
      " Error generating meal plan:",
      error.response?.data || error.message
    );
    await message.reply("⚠️ Failed to generate meal plan. Try again later.");
  }
}

// Login Bot
client.login(process.env.DISCORD_BOT_TOKEN);
