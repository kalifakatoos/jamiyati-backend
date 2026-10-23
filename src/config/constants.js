module.exports = {
  ROLES: {
    ADMIN: 'admin',
    MEMBER: 'member'
  },

  CIRCLE_STATUS: {
    DRAFT: 'draft',
    OPEN: 'open',
    READY_FOR_DRAW: 'ready_for_draw',
    ACTIVE: 'active',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled'
  },

  TURN_METHOD: {
    RANDOM_DRAW: 'random_draw',
    MUTUAL_AGREEMENT: 'mutual_agreement'
  },

  ROUND_STATUS: {
    SCHEDULED: 'scheduled',
    COLLECTING: 'collecting',
    DELIVERED: 'delivered',
    ROUND_CLOSED: 'round_closed'
  },

  PAYMENT_STATUS: {
    UNPAID: 'unpaid',
    RECEIPT_UPLOADED: 'receipt_uploaded',
    CONFIRMED: 'confirmed',
    DISPUTED: 'disputed'
  },

  NOTIFICATION_TYPES: {
    REMINDER: 'reminder',
    RECEIPT_UPLOADED: 'receipt_uploaded',
    RECEIPT_CONFIRMED: 'receipt_confirmed',
    DRAW_COMPLETED: 'draw_completed',
    TURN_SWAP: 'turn_swap',
    ROUND_CLOSED: 'round_closed',
    TRUST_UPDATE: 'trust_update',
    SYSTEM: 'system'
  },

  TRUST_SCORE: {
    DEFAULT: 80,
    MIN: 0,
    MAX: 100,
    ON_TIME_PAYMENT: 3,
    DELAYED_PAYMENT: -5,
    DISPUTE_PENALTY: -10,
    FOUNDER_BONUS: 5
  }
};
