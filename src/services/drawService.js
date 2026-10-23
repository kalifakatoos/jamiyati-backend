const crypto = require('crypto');

/**
 * 32-bit Seeded PRNG (Mulberry32 Engine)
 * Provides deterministic pseudo-random numbers from a numeric seed
 */
function createPRNG(seedNum) {
  return function () {
    let t = (seedNum += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Executes Sharia-Compliant Fair Draw for ROSCA Circles
 * 1. Mutual Consent Priority Slots (التراضي لذوي الحاجة العاجلة)
 * 2. Deterministic Seed generation (الشفافية وقابلية التحقق التام)
 * 3. Seeded Mulberry32 Fisher-Yates Uniform Shuffle for remaining slots
 * 
 * @param {number} circleId 
 * @param {Array<{userId: number, userName: string, isMutualPriority?: boolean, priorityRound?: number, priorityReason?: string}>} members 
 * @param {number} totalMembers 
 * @param {string} createdAtIso 
 * @param {string} entropy 
 * @returns {{circleId: number, seed: string, executedAt: string, schedule: Array}}
 */
function executeShariaFairDraw(
  circleId,
  members,
  totalMembers,
  createdAtIso,
  entropy = 'JAMITYATI_HALAL_ENTROPY'
) {
  if (!Array.isArray(members) || members.length !== totalMembers) {
    throw new Error(`يجب اكتمال عدد أعضاء الجمعية بالكامل (${totalMembers}) قبل إجراء القرعة.`);
  }

  // 1. Generate Deterministic Public Seed
  const sortedIds = members.map((m) => m.userId).sort((a, b) => a - b).join(',');
  const seedString = `${circleId}:${sortedIds}:${createdAtIso}:${entropy}`;
  const seedHash = crypto.createHash('sha256').update(seedString).digest('hex');
  const numericSeed = parseInt(seedHash.substring(0, 8), 16);
  const random = createPRNG(numericSeed);

  // 2. Prepare Slots (1 to N)
  const schedule = new Array(totalMembers).fill(null);

  // 3. Place Mutual Priority Allocations First (التراضي)
  const drawPool = [];
  for (const member of members) {
    if (member.isMutualPriority && member.priorityRound) {
      const targetIndex = member.priorityRound - 1;
      if (targetIndex >= 0 && targetIndex < totalMembers && schedule[targetIndex] === null) {
        schedule[targetIndex] = {
          roundNumber: member.priorityRound,
          userId: member.userId,
          userName: member.userName,
          isPriority: true,
          reason: member.priorityReason || 'Mutual Consent Agreement'
        };
      } else {
        throw new Error(`تعارض في تخصيص الدور رقم ${member.priorityRound} بالأولوية.`);
      }
    } else {
      drawPool.push(member);
    }
  }

  // 4. Fisher-Yates Unbiased Shuffle for Remaining Slots
  for (let i = drawPool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [drawPool[i], drawPool[j]] = [drawPool[j], drawPool[i]];
  }

  // 5. Fill Empty Slots Sequentially with Shuffled Pool
  let poolIdx = 0;
  for (let r = 0; r < totalMembers; r++) {
    if (schedule[r] === null) {
      const selected = drawPool[poolIdx++];
      schedule[r] = {
        roundNumber: r + 1,
        userId: selected.userId,
        userName: selected.userName,
        isPriority: false,
        reason: null
      };
    }
  }

  return {
    circleId,
    seed: seedHash,
    executedAt: new Date().toISOString(),
    schedule
  };
}

/**
 * Calculate due dates for each round
 */
function calculateRoundDueDate(startDateStr, paymentDayOfMonth, roundNumber) {
  const baseDate = new Date(startDateStr);
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth() + (roundNumber - 1);
  
  // Create date for the target month
  const targetDate = new Date(year, month, paymentDayOfMonth);
  return targetDate.toISOString().split('T')[0];
}

module.exports = {
  executeShariaFairDraw,
  calculateRoundDueDate
};
