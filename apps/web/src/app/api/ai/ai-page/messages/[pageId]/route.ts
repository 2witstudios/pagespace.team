import { streamText, CoreMessage, tool } from 'ai';
import { db, and, eq, gte } from '@pagespace/db';
import { pages, chatMessages, aiChats } from '@pagespace/db';
import { z } from 'zod';
import { NextResponse } from 'next/server';
import { decodeToken, getUserAccessLevel, permissionPrecedence, PermissionAction } from '@pagespace/lib';
import { extractMentionContexts } from '@/lib/mention-context';
import { parse } from 'cookie';
import { createId } from '@paralleldrive/cuid2';
import { resolveModel, createModelInstance, handleModelError } from '@/app/api/ai/shared/models';

const postSchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(['user', 'assistant']),
      content: z.union([z.string(), z.object({ type: z.string() }).passthrough()]), // Can be string or Tiptap JSON
      createdAt: z.string().datetime().optional(),
    })
  ),
  isEdit: z.boolean().optional(),
  editedMessageCreatedAt: z.string().datetime().optional(),
  isRegenerate: z.boolean().optional(),
  regeneratedMessageCreatedAt: z.string().datetime().optional(),
});

export async function POST(
  req: Request,
  context: { params: Promise<{ pageId: string }> }
) {
  try {
    const { pageId } = await context.params;
    
    const cookieHeader = req.headers.get('cookie');
    const cookies = parse(cookieHeader || '');
    const accessToken = cookies.accessToken;

    if (!accessToken) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const decoded = await decodeToken(accessToken);
    if (!decoded) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
    const userId = decoded.userId;

    const body = await req.json();
    const { messages, isEdit, editedMessageCreatedAt, isRegenerate, regeneratedMessageCreatedAt } = postSchema.parse(body) as { messages: CoreMessage[], isEdit?: boolean, editedMessageCreatedAt?: string, isRegenerate?: boolean, regeneratedMessageCreatedAt?: string };

    // Manual permission check inspired by withPageAuth
    const accessLevel = await getUserAccessLevel(userId, pageId);
    if (!accessLevel) {
        return new NextResponse("Forbidden", { status: 403 });
    }

    const requiredLevel = permissionPrecedence.indexOf(PermissionAction.EDIT);
    const userLevel = permissionPrecedence.indexOf(accessLevel);

    if (userLevel < requiredLevel) {
        return new NextResponse("Forbidden: You need EDIT access to use the chat.", { status: 403 });
    }
    // End permission check

    if (isEdit && editedMessageCreatedAt) {
        await db.update(chatMessages).set({ isActive: false, editedAt: new Date() }).where(and(eq(chatMessages.pageId, pageId), gte(chatMessages.createdAt, new Date(editedMessageCreatedAt))));
    }

    if (isRegenerate && regeneratedMessageCreatedAt) {
        await db.update(chatMessages).set({ isActive: false, editedAt: new Date() }).where(and(eq(chatMessages.pageId, pageId), gte(chatMessages.createdAt, new Date(regeneratedMessageCreatedAt))));
    }

    const page = await db.query.pages.findFirst({
        where: eq(pages.id, pageId),
    });

    const aiChat = await db.query.aiChats.findFirst({
        where: eq(aiChats.pageId, pageId),
    });

    if (!page) {
        return new NextResponse("Not Found", { status: 404 });
    }
    
    if (page.isTrashed) {
        return new NextResponse("Forbidden: Page is in trash.", { status: 403 });
    }

    const lastUserMessage = messages[messages.length - 1];

    // --- Enhanced Mention Processing Logic ---
    let mentionedContent = '';
    if (typeof lastUserMessage.content === 'string' || (typeof lastUserMessage.content === 'object' && lastUserMessage.content !== null)) {
      try {
        mentionedContent = await extractMentionContexts(lastUserMessage.content as string | Record<string, unknown>, userId);
      } catch (error) {
        console.warn('Failed to extract mention contexts:', error);
        mentionedContent = '';
      }
    }
    // --- End of Mention Processing Logic ---

    // Get the model from the AI chat configuration
    const modelToUse = aiChat?.model;

    if (!modelToUse) {
      return NextResponse.json({ error: 'No model configured for this chat. Please select a model in settings.' }, { status: 400 });
    }
    
    let modelProvider;
    try {
        const { apiKey } = await resolveModel(userId, modelToUse);
        modelProvider = createModelInstance(modelToUse, apiKey);
    } catch (error) {
        return handleModelError(error);
    }

    const systemPrompt = aiChat?.systemPrompt || 
      'You are a helpful and friendly AI assistant. Answer the questions in a concise and accurate manner.';
    
    const enhancedSystemPrompt = mentionedContent 
      ? `${systemPrompt}\n\nThe user has mentioned the following in their message:\n${mentionedContent}`
      : systemPrompt;

    const result = await streamText({
      model: modelProvider,
      system: enhancedSystemPrompt,
      messages: messages.map(m => ({...m, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)})) as CoreMessage[],
      temperature: aiChat?.temperature || 0.7,
      tools: {
        getWeather: tool({
          description: 'Get the weather in a location',
          parameters: z.object({
            location: z.string().describe('The location to get the weather for'),
          }),
          execute: async ({ location }) => {
            // Simulate fetching weather data
            const temperature = Math.round(Math.random() * (90 - 32) + 32);
            return {
              location,
              temperature,
              message: `The weather in ${location} is currently ${temperature}°F.`,
            };
          },
        }),
      },
      onFinish: async ({ text, toolCalls, toolResults }) => {
        const lastUserMessage = messages[messages.length - 1];
        
        // Use transaction to ensure both messages are saved atomically
        await db.transaction(async (tx) => {
          await tx.insert(chatMessages).values({
              id: createId(),
              pageId,
              userId,
              role: 'user',
              content: typeof lastUserMessage.content === 'string' ? lastUserMessage.content : JSON.stringify(lastUserMessage.content),
              isActive: true,
              createdAt: new Date(),
          });

          await tx.insert(chatMessages).values({
              id: createId(),
              pageId,
              role: 'assistant',
              content: text,
              toolCalls: toolCalls,
              toolResults: toolResults,
              isActive: true,
              createdAt: new Date(),
          });
        });
      }
    });

    return result.toDataStreamResponse();
  } catch (error) {
    console.error('Error in AI chat:', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }
    return NextResponse.json({ error: 'Failed to process chat' }, { status: 500 });
  }
}