# How to Add a New Page Type

This guide explains how to add a new page type to the application. Page types define how the content in the middle panel is rendered.

## 1. Prerequisites

Before adding a new page type, you should be familiar with the following concepts:

-   **Component Architecture:** Understand how components are organized in the `/components` directory. See the [Component Organization Philosophy](./../04_frontend/01_component_architecture.md) for more details.
-   **Layout System:** Understand the five-section layout and where to place new components. See the [Layout Architecture](./../04_frontend/02_layout_system.md) for more details.

## 2. Overview of Page Types

Page types are defined by the `PageType` enum located in [`packages/lib/src/enums.ts`](packages/lib/src/enums.ts:1). Each value in this enum corresponds to a specific type of content view.

The rendering logic is handled in the `PageContent` component, found in [`apps/web/src/components/layout/middle-content/index.tsx`](apps/web/src/components/layout/middle-content/index.tsx:54). A `switch` statement on the `page.type` property determines which React component to render for the selected page.

### Existing Page Types

-   `FOLDER`: Displays content as a folder.
-   `DOCUMENT`: Renders a rich-text editor for documents.
-   `DATABASE`: A deprecated page type.
-   `CHANNEL`: For chat-like communication channels.
-   `AI_CHAT`: A view for interacting with an AI chat.

## 2. Steps to Add a New Page Type

### Step 1: Create the View Component

First, create a new React component that will render the view for your new page type. It's best to follow the existing structure and place your new component in a new directory inside [`apps/web/src/components/layout/middle-content/page-views/`](apps/web/src/components/layout/middle-content/page-views/).

For example, to create a "KANBAN" page type:

```tsx
// apps/web/src/components/layout/middle-content/page-views/kanban/KanbanView.tsx

import { Page } from "@pagespace/lib";

const KanbanView = ({ page }: { page: Page }) => {
  return (
    <div>
      <h1>{page.title}</h1>
      {/* Your Kanban board implementation here */}
    </div>
  );
};

export default KanbanView;
```

### Step 2: Update the `PageType` Enum

Next, add your new page type to the `PageType` enum in [`packages/lib/src/enums.ts`](packages/lib/src/enums.ts:1).

```typescript
// packages/lib/src/enums.ts

export enum PageType {
  FOLDER = 'FOLDER',
  DOCUMENT = 'DOCUMENT',
  DATABASE = 'DATABASE',
  CHANNEL = 'CHANNEL',
  AI_CHAT = 'AI_CHAT',
  KANBAN = 'KANBAN', // Add your new type here
}
```

### Step 3: Update the Database Schema

Add the new `PageType` to the `pageType` enum in [`packages/db/src/schema/enums.ts`](packages/db/src/schema/enums.ts).

```typescript
// packages/db/src/schema/enums.ts

export const pageType = pgEnum('page_type', [
    'FOLDER',
    'DOCUMENT',
    'DATABASE',
    'CHANNEL',
    'AI_CHAT',
    'KANBAN', // Add your new type here
]);
```

After updating the schema, you will need to generate and apply a new migration.

### Step 4: Render the New View

Finally, import your new component and add a `case` to the `switch` statement in the `PageContent` component ([`apps/web/src/components/layout/middle-content/index.tsx`](apps/web/src/components/layout/middle-content/index.tsx:54)).

```tsx
// apps/web/src/components/layout/middle-content/index.tsx

// ... other imports
import KanbanView from './page-views/kanban/KanbanView';

// ...

const PageContent = ({ pageId }: { pageId: string | null }) => {
  // ...
  
  switch (page.type) {
    case PageType.DOCUMENT:
      return <Editor key={page.id} page={page} />;
    case PageType.FOLDER:
      return <FolderView key={page.id} page={page} />;
    case PageType.AI_CHAT:
      return <AiChatView key={page.id} page={page} />;
    case PageType.CHANNEL:
      return <ChannelView key={page.id} page={page} />;
    case PageType.DATABASE:
        return <div className="p-4">This page type is deprecated.</div>;
    case PageType.KANBAN: // Add new case
        return <KanbanView key={page.id} page={page} />;
    default:
      return <div className="p-4">This page type is not supported.</div>;
  }
};
```

By following these steps, you can successfully integrate a new page type into the application.

## 3. Best Practices

-   **Keep View Components Simple:** The view component should be responsible for rendering the content of the page, not for fetching data. Data fetching should be handled by hooks, as described in the [Page State Management Architecture](./../04_frontend/03_state_management.md) guide.
-   **Follow Naming Conventions:** Follow the naming conventions for directories and components, as described in the [File Naming Conventions](./02_naming_conventions.md) guide.
-   **Update Documentation:** After adding a new page type, be sure to update this guide and any other relevant documentation.