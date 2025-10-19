const ROLE_ORDER = ['admin', 'moderator', 'judge', 'artist', 'listener'] as const;

const ROLE_PRIORITY = ROLE_ORDER.reduce<Record<string, number>>((acc, role, index) => {
  acc[role] = index;
  return acc;
}, {});

const isKnownRole = (value: unknown): value is string =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(ROLE_PRIORITY, value);

/**
 * Returns unique roles sorted by business hierarchy.
 */
export const normalizeUserRoles = (roles: Iterable<unknown>): string[] => {
  const seen = new Set<string>();

  for (const role of roles) {
    if (isKnownRole(role)) {
      seen.add(role);
    }
  }

  return Array.from(seen).sort((a, b) => ROLE_PRIORITY[a] - ROLE_PRIORITY[b]);
};

export const roleOrder = [...ROLE_ORDER];

export const roleOrderSqlLiteral = `ARRAY[${ROLE_ORDER.map((role) => `'${role}'`).join(',')}]::user_role[]`;
