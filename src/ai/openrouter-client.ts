import OpenAI from 'openai';
import * as dotenv from 'dotenv';

dotenv.config();

export const openrouter = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1'
});
