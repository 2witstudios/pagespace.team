import { NextResponse } from 'next/server';
import { decodeToken, getUserAccessLevel } from '@pagespace/lib';
import { parse } from 'cookie';
import { pages, users, assistantConversations, db, and, eq, ilike, or } from '@pagespace/db';
import { MentionSuggestion, MentionType } from '@/types/mentions';

export async function GET(request: Request) {
  const cookieHeader = request.headers.get('cookie');
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

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q') || '';
  const driveId = searchParams.get('driveId');
  const typesParam = searchParams.get('types'); // Comma-separated types
  
  if (!driveId) {
    return NextResponse.json(
      { error: 'Missing driveId parameter' },
      { status: 400 }
    );
  }

  // Parse requested mention types, default to all types
  const requestedTypes = typesParam 
    ? typesParam.split(',') as MentionType[]
    : ['page', 'user', 'ai-page', 'ai-assistant', 'channel'];

  try {
    const suggestions: MentionSuggestion[] = [];

    // Search pages (including ai-page and channels)
    if (requestedTypes.some(type => ['page', 'ai-page', 'channel'].includes(type))) {
      const pageResults = await db.select({
        id: pages.id,
        title: pages.title,
        type: pages.type,
      })
      .from(pages)
      .where(
        and(
          eq(pages.driveId, driveId),
          query ? ilike(pages.title, `%${query}%`) : undefined,
          eq(pages.isTrashed, false)
        )
      )
      .limit(10);

      // Filter by permissions and requested types
      for (const page of pageResults) {
        const accessLevel = await getUserAccessLevel(userId, page.id);
        if (!accessLevel) continue;

        let mentionType: MentionType;
        if (page.type === 'AI_CHAT' && requestedTypes.includes('ai-page')) {
          mentionType = 'ai-page';
        } else if (page.type === 'CHANNEL' && requestedTypes.includes('channel')) {
          mentionType = 'channel';
        } else if (['DOCUMENT', 'FOLDER', 'DATABASE'].includes(page.type) && requestedTypes.includes('page')) {
          mentionType = 'page';
        } else {
          continue; // Skip if type not requested
        }

        suggestions.push({
          id: page.id,
          label: page.title,
          type: mentionType,
          data: {
            pageType: page.type as 'DOCUMENT' | 'FOLDER' | 'DATABASE' | 'CHANNEL' | 'AI_CHAT',
            driveId: driveId,
          },
          description: `${page.type.toLowerCase()} in drive`,
        });
      }
    }

    // Search users (if user mentions are requested)
    if (requestedTypes.includes('user')) {
      const userResults = await db.select({
        id: users.id,
        name: users.name,
        email: users.email,
        image: users.image,
      })
      .from(users)
      .where(
        query ? or(
          ilike(users.name, `%${query}%`),
          ilike(users.email, `%${query}%`)
        ) : undefined
      )
      .limit(5);

      for (const user of userResults) {
        suggestions.push({
          id: user.id,
          label: user.name || user.email,
          type: 'user',
          data: {
            email: user.email,
            avatar: user.image || undefined,
          },
          description: user.email,
        });
      }
    }

    // Search assistant conversations (if ai-assistant mentions are requested)
    if (requestedTypes.includes('ai-assistant')) {
      const conversationResults = await db.select({
        id: assistantConversations.id,
        title: assistantConversations.title,
        driveId: assistantConversations.driveId,
        createdAt: assistantConversations.createdAt,
        updatedAt: assistantConversations.updatedAt,
      })
      .from(assistantConversations)
      .where(
        and(
          eq(assistantConversations.driveId, driveId),
          eq(assistantConversations.userId, userId), // Only show user's own conversations
          query ? ilike(assistantConversations.title, `%${query}%`) : undefined
        )
      )
      .limit(5);

      for (const conversation of conversationResults) {
        suggestions.push({
          id: conversation.id,
          label: conversation.title,
          type: 'ai-assistant',
          data: {
            conversationId: conversation.id,
            title: conversation.title,
            driveId: conversation.driveId,
            messageCount: 0, // Could be calculated if needed
            lastActivity: conversation.updatedAt,
          },
          description: 'Assistant conversation',
        });
      }
    }

    // Sort suggestions by relevance (exact matches first, then alphabetical)
    suggestions.sort((a, b) => {
      const aExact = a.label.toLowerCase() === query.toLowerCase();
      const bExact = b.label.toLowerCase() === query.toLowerCase();
      
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;
      
      return a.label.localeCompare(b.label);
    });

    return NextResponse.json(suggestions.slice(0, 10));
  } catch (error) {
    console.error('[MENTIONS_SEARCH_GET]', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}