import Groq from 'groq-sdk';
import * as dotenv from 'dotenv';

dotenv.config();

export const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
