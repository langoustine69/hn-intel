import { createAgent } from '@lucid-agents/core';
import { http } from '@lucid-agents/http';
import { createAgentApp } from '@lucid-agents/hono';
import { payments, paymentsFromEnv } from '@lucid-agents/payments';
import { z } from 'zod';

const HN_API = 'https://hacker-news.firebaseio.com/v0';

// === Helper Functions ===
async function fetchJSON<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`API error: ${response.status}`);
  return response.json() as Promise<T>;
}

interface HNItem {
  id: number;
  type: 'story' | 'comment' | 'job' | 'poll' | 'pollopt';
  by?: string;
  time?: number;
  text?: string;
  url?: string;
  title?: string;
  score?: number;
  descendants?: number;
  kids?: number[];
}

async function getStoryIds(endpoint: string): Promise<number[]> {
  return fetchJSON<number[]>(`${HN_API}/${endpoint}.json`);
}

async function getItem(id: number): Promise<HNItem> {
  return fetchJSON<HNItem>(`${HN_API}/item/${id}.json`);
}

async function getStoriesWithDetails(ids: number[], limit: number = 10): Promise<any[]> {
  const sliced = ids.slice(0, Math.min(limit, 30));
  const stories = await Promise.all(sliced.map(id => getItem(id)));
  return stories.filter(Boolean).map(story => ({
    id: story.id,
    title: story.title,
    url: story.url,
    score: story.score ?? 0,
    by: story.by,
    time: story.time ? new Date(story.time * 1000).toISOString() : null,
    comments: story.descendants ?? 0,
    hnUrl: `https://news.ycombinator.com/item?id=${story.id}`
  }));
}

// === Agent Setup ===
const agent = await createAgent({
  name: 'hn-intel',
  version: '1.0.0',
  description: 'Hacker News Intelligence - Real-time tech news, trending stories, and community insights from HN',
})
  .use(http())
  .use(payments({ config: paymentsFromEnv() }))
  .build();

const { app, addEntrypoint } = await createAgentApp(agent);

// === FREE ENDPOINT: Overview ===
addEntrypoint({
  key: 'overview',
  description: 'Free overview of top 5 Hacker News stories - try before you buy',
  input: z.object({}),
  price: { amount: 0 },
  handler: async () => {
    const topIds = await getStoryIds('topstories');
    const stories = await getStoriesWithDetails(topIds, 5);
    return {
      output: {
        stories,
        totalTopStories: topIds.length,
        fetchedAt: new Date().toISOString(),
        source: 'Hacker News Firebase API (live)'
      }
    };
  },
});

// === PAID ENDPOINT 1: Top Stories ($0.001) ===
addEntrypoint({
  key: 'top',
  description: 'Get top N Hacker News stories with full details',
  input: z.object({
    limit: z.number().min(1).max(30).optional().default(10)
  }),
  price: { amount: 1000 },
  handler: async (ctx) => {
    const topIds = await getStoryIds('topstories');
    const stories = await getStoriesWithDetails(topIds, ctx.input.limit);
    return {
      output: {
        stories,
        count: stories.length,
        fetchedAt: new Date().toISOString()
      }
    };
  },
});

// === PAID ENDPOINT 2: New Stories ($0.001) ===
addEntrypoint({
  key: 'new',
  description: 'Get newest N Hacker News stories',
  input: z.object({
    limit: z.number().min(1).max(30).optional().default(10)
  }),
  price: { amount: 1000 },
  handler: async (ctx) => {
    const newIds = await getStoryIds('newstories');
    const stories = await getStoriesWithDetails(newIds, ctx.input.limit);
    return {
      output: {
        stories,
        count: stories.length,
        fetchedAt: new Date().toISOString()
      }
    };
  },
});

// === PAID ENDPOINT 3: Best Stories ($0.002) ===
addEntrypoint({
  key: 'best',
  description: 'Get best/highest-rated Hacker News stories of all time',
  input: z.object({
    limit: z.number().min(1).max(30).optional().default(10)
  }),
  price: { amount: 2000 },
  handler: async (ctx) => {
    const bestIds = await getStoryIds('beststories');
    const stories = await getStoriesWithDetails(bestIds, ctx.input.limit);
    return {
      output: {
        stories,
        count: stories.length,
        fetchedAt: new Date().toISOString()
      }
    };
  },
});

// === PAID ENDPOINT 4: Full Story with Comments ($0.002) ===
addEntrypoint({
  key: 'story',
  description: 'Get full story details including top comments',
  input: z.object({
    id: z.number().describe('Hacker News story ID')
  }),
  price: { amount: 2000 },
  handler: async (ctx) => {
    const story = await getItem(ctx.input.id);
    if (!story || story.type !== 'story') {
      throw new Error('Story not found');
    }
    
    // Fetch top 5 comments
    const commentIds = story.kids?.slice(0, 5) ?? [];
    const comments = await Promise.all(commentIds.map(id => getItem(id)));
    
    return {
      output: {
        story: {
          id: story.id,
          title: story.title,
          url: story.url,
          text: story.text,
          score: story.score ?? 0,
          by: story.by,
          time: story.time ? new Date(story.time * 1000).toISOString() : null,
          totalComments: story.descendants ?? 0,
          hnUrl: `https://news.ycombinator.com/item?id=${story.id}`
        },
        topComments: comments.filter(Boolean).map(c => ({
          id: c.id,
          by: c.by,
          text: c.text,
          time: c.time ? new Date(c.time * 1000).toISOString() : null
        })),
        fetchedAt: new Date().toISOString()
      }
    };
  },
});

// === PAID ENDPOINT 5: Trending Analysis ($0.003) ===
addEntrypoint({
  key: 'trending',
  description: 'Aggregated trending analysis: top stories, Ask HN, and Show HN combined',
  input: z.object({
    limit: z.number().min(1).max(10).optional().default(5)
  }),
  price: { amount: 3000 },
  handler: async (ctx) => {
    const [topIds, askIds, showIds] = await Promise.all([
      getStoryIds('topstories'),
      getStoryIds('askstories'),
      getStoryIds('showstories')
    ]);
    
    const [topStories, askStories, showStories] = await Promise.all([
      getStoriesWithDetails(topIds, ctx.input.limit),
      getStoriesWithDetails(askIds, ctx.input.limit),
      getStoriesWithDetails(showIds, ctx.input.limit)
    ]);
    
    // Extract common themes/domains
    const domains = topStories
      .filter(s => s.url)
      .map(s => {
        try {
          return new URL(s.url).hostname.replace('www.', '');
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    
    return {
      output: {
        topStories,
        askHN: askStories,
        showHN: showStories,
        insights: {
          hotDomains: [...new Set(domains)].slice(0, 5),
          totalEngagement: topStories.reduce((sum, s) => sum + s.score + s.comments, 0),
          avgScore: Math.round(topStories.reduce((sum, s) => sum + s.score, 0) / topStories.length)
        },
        fetchedAt: new Date().toISOString()
      }
    };
  },
});

const port = Number(process.env.PORT ?? 3000);
console.log(`🔶 HN Intel Agent running on port ${port}`);

export default { port, fetch: app.fetch };
