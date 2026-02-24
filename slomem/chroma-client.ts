import { CloudClient } from 'chromadb';
import * as dotenv from 'dotenv';

dotenv.config();

const COLLECTION_NAME = 'agent_sessions';

let client: CloudClient | null = null;

export async function getCollection() {
    if (!client) {
        client = new CloudClient({
            apiKey: process.env.CHROMA_API_KEY!,
            tenant: process.env.CHROMA_TENANT!,
            database: process.env.CHROMA_DATABASE!
        });
    }

    const collection = await client.getOrCreateCollection({
        name: COLLECTION_NAME,
        metadata: { description: 'Mineru agent session memories for URL caching' }
    });

    return collection;
}
