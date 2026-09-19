import { evaluateCedar, PRD_PERMISSION_MATRIX } from '../services/authorizer/src/index.js';
import { Role } from '@opslens/contracts';

const ALL_ROLES: Role[] = ['worker', 'maintenance', 'supervisor', 'manager', 'admin'];

async function main() {
  console.log('## Cedar Decision Matrix vs. PRD §FR-11.3 Permission Matrix\n');

  const actions = Object.keys(PRD_PERMISSION_MATRIX);
  let totalCells = 0;
  let matches = 0;
  let disagreements = 0;

  console.log('| Action | Resource | Worker | Maintenance | Supervisor | Manager | Admin | Status |');
  console.log('|---|---|:---:|:---:|:---:|:---:|:---:|:---:|');

  for (const action of actions) {
    const spec = PRD_PERMISSION_MATRIX[action]!;
    const rowResults: Record<Role, { decision: string; prdExpected: string; match: boolean }> = {} as any;

    let rowAllMatch = true;

    for (const role of ALL_ROLES) {
      totalCells++;
      const shouldAllow = spec.allowedRoles.includes(role);
      const prdExpected = shouldAllow ? 'ALLOW' : 'DENY';

      const result = evaluateCedar({
        principal: {
          id: `usr-${role}`,
          tenantId: 'north-hub',
          role,
        },
        action,
        resource: {
          type: spec.resourceType,
          id: `${spec.resourceType.toLowerCase()}-1`,
          tenantId: 'north-hub',
        },
      });

      const actualDecision = result.decision.toUpperCase();
      const isMatch = actualDecision === prdExpected;

      if (!isMatch) {
        rowAllMatch = false;
        disagreements++;
      } else {
        matches++;
      }

      rowResults[role] = {
        decision: actualDecision,
        prdExpected,
        match: isMatch,
      };
    }

    const fmt = (r: Role) => {
      const cell = rowResults[r];
      if (cell.match) {
        return cell.decision === 'ALLOW' ? '✅ ALLOW' : '❌ DENY';
      } else {
        return `⚠️ DIFF (got ${cell.decision}, expected ${cell.prdExpected})`;
      }
    };

    console.log(
      `| \`${action}\` | \`${spec.resourceType}\` | ${fmt('worker')} | ${fmt('maintenance')} | ${fmt('supervisor')} | ${fmt('manager')} | ${fmt('admin')} | ${rowAllMatch ? 'MATCH' : 'DISAGREE'} |`,
    );
  }

  console.log(`\n**Total cells evaluated:** ${totalCells} (${actions.length} actions × ${ALL_ROLES.length} roles)`);
  console.log(`**Matches:** ${matches}`);
  console.log(`**Disagreements:** ${disagreements}`);

  if (disagreements > 0) {
    console.error(`\nFAILED: Found ${disagreements} cell disagreements!`);
    process.exit(1);
  } else {
    console.log('\nPASSED: 100% agreement between Cedar policy decisions and PRD permission matrix.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
