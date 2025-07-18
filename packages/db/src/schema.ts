export * from './schema/auth';
export * from './schema/core';
export * from './schema/permissions';
export * from './schema/chat';
export * from './schema/ai';

import * as auth from './schema/auth';
import * as core from './schema/core';
import * as permissions from './schema/permissions';
import * as chat from './schema/chat';
import * as ai from './schema/ai';

export const schema = {
  ...auth,
  ...core,
  ...permissions,
  ...chat,
  ...ai,
};