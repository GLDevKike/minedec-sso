import {
  ALLOWED_PIP_SQL_IDENTIFIERS,
  SAFE_SQL_IDENTIFIER_REGEX,
  safeSqlIdentifier,
  quotePipIdentifier,
} from '../db/postgres-client';

export {
  ALLOWED_PIP_SQL_IDENTIFIERS,
  SAFE_SQL_IDENTIFIER_REGEX,
  safeSqlIdentifier,
  quotePipIdentifier,
};

export const assertSafeSqlIdentifier = safeSqlIdentifier;
