/**
 * Simple line-based diff using the longest common subsequence approach.
 * Returns hunks of added/removed lines with context.
 */

export interface DiffLine {
  type: 'add' | 'remove' | 'context';
  content: string;
}

export interface DiffHunk {
  lines: DiffLine[];
}

function lcs(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  return dp;
}

function backtrack(dp: number[][], a: string[], b: string[]): DiffLine[] {
  const result: DiffLine[] = [];
  let i = a.length;
  let j = b.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      result.unshift({ type: 'context', content: a[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: 'add', content: b[j - 1] });
      j--;
    } else {
      result.unshift({ type: 'remove', content: a[i - 1] });
      i--;
    }
  }

  return result;
}

/**
 * Compute a line-based diff between two strings.
 * Returns hunks with 2 lines of context around changes.
 */
export function computeDiff(oldText: string, newText: string): DiffHunk[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  // Limit diff computation for very large notes (avoid O(n*m) explosion)
  if (oldLines.length > 500 || newLines.length > 500) {
    // Fallback: just show summary
    return [{
      lines: [
        { type: 'remove', content: `(${oldLines.length} lignes)` },
        { type: 'add', content: `(${newLines.length} lignes)` },
      ],
    }];
  }

  const dp = lcs(oldLines, newLines);
  const allLines = backtrack(dp, oldLines, newLines);

  // Group into hunks: sequences of changes with 2 lines of context
  const contextSize = 2;
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffLine[] = [];
  let contextAfter = 0;
  let inChange = false;

  for (let idx = 0; idx < allLines.length; idx++) {
    const line = allLines[idx];

    if (line.type !== 'context') {
      // If starting a new change, add preceding context
      if (!inChange) {
        const start = Math.max(0, idx - contextSize);
        for (let c = start; c < idx; c++) {
          if (allLines[c].type === 'context') {
            currentHunk.push(allLines[c]);
          }
        }
      }
      currentHunk.push(line);
      inChange = true;
      contextAfter = 0;
    } else if (inChange) {
      contextAfter++;
      currentHunk.push(line);
      if (contextAfter >= contextSize) {
        // Close this hunk
        hunks.push({ lines: currentHunk });
        currentHunk = [];
        inChange = false;
        contextAfter = 0;
      }
    }
  }

  // Close any remaining hunk
  if (currentHunk.length > 0) {
    hunks.push({ lines: currentHunk });
  }

  return hunks;
}
