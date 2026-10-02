import type { Assignment, AssignmentInput, MonitoredTarget } from '@shared/types';
import type { Db } from '../connection';

interface AssignmentRow {
  id: number;
  name: string;
  module: string;
  description: string;
  deadline: number | null;
  target_words: number | null;
  current_words: number;
  estimated_hours: number | null;
  notes: string;
  archived_at: number | null;
  created_at: number;
  is_demo: number;
}

interface TargetRow {
  id: number;
  assignment_id: number;
  path: string;
  kind: 'file' | 'folder';
  created_at: number;
}

const mapTarget = (r: TargetRow): MonitoredTarget => ({
  id: r.id,
  assignmentId: r.assignment_id,
  path: r.path,
  kind: r.kind,
  createdAt: r.created_at,
});

export class AssignmentRepository {
  constructor(private readonly db: Db) {}

  list(includeArchived: boolean): Assignment[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM assignments ${includeArchived ? '' : 'WHERE archived_at IS NULL'}
         ORDER BY archived_at IS NOT NULL, COALESCE(deadline, 9e15), created_at DESC`,
      )
      .all() as AssignmentRow[];
    const targets = this.db.prepare('SELECT * FROM monitored_files ORDER BY id').all() as TargetRow[];
    return rows.map((r) => this.map(r, targets.filter((t) => t.assignment_id === r.id)));
  }

  get(id: number): Assignment | null {
    const row = this.db.prepare('SELECT * FROM assignments WHERE id = ?').get(id) as AssignmentRow | undefined;
    if (!row) return null;
    const targets = this.db.prepare('SELECT * FROM monitored_files WHERE assignment_id = ?').all(id) as TargetRow[];
    return this.map(row, targets);
  }

  create(input: AssignmentInput, isDemo = false, createdAt = Date.now()): Assignment {
    const id = this.db.transaction(() => {
      const res = this.db
        .prepare(
          `INSERT INTO assignments (name, module, description, deadline, target_words, current_words,
             estimated_hours, notes, created_at, is_demo)
           VALUES (@name, @module, @description, @deadline, @targetWordCount, @currentWordCount,
             @estimatedHours, @notes, @createdAt, @isDemo)`,
        )
        .run({ ...this.params(input), createdAt, isDemo: isDemo ? 1 : 0 });
      const newId = Number(res.lastInsertRowid);
      this.replaceTargets(newId, input.targets);
      return newId;
    })();
    return this.mustGet(id);
  }

  update(id: number, input: AssignmentInput): Assignment {
    this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE assignments SET name=@name, module=@module, description=@description, deadline=@deadline,
             target_words=@targetWordCount, current_words=@currentWordCount, estimated_hours=@estimatedHours,
             notes=@notes WHERE id=@id`,
        )
        .run({ ...this.params(input), id });
      this.replaceTargets(id, input.targets);
    })();
    return this.mustGet(id);
  }

  setArchived(id: number, archived: boolean): Assignment {
    this.db.prepare('UPDATE assignments SET archived_at = ? WHERE id = ?').run(archived ? Date.now() : null, id);
    return this.mustGet(id);
  }

  setCurrentWords(id: number, words: number): void {
    this.db.prepare('UPDATE assignments SET current_words = ? WHERE id = ?').run(Math.max(0, Math.round(words)), id);
  }

  delete(id: number): void {
    this.db.prepare('DELETE FROM assignments WHERE id = ?').run(id);
  }

  private mustGet(id: number): Assignment {
    const a = this.get(id);
    if (!a) throw new Error(`Assignment ${id} not found`);
    return a;
  }

  private params(input: AssignmentInput): Record<string, string | number | null> {
    return {
      name: input.name,
      module: input.module,
      description: input.description,
      deadline: input.deadline,
      targetWordCount: input.targetWordCount,
      currentWordCount: input.currentWordCount,
      estimatedHours: input.estimatedHours,
      notes: input.notes,
    };
  }

  private replaceTargets(id: number, targets: AssignmentInput['targets']): void {
    this.db.prepare('DELETE FROM monitored_files WHERE assignment_id = ?').run(id);
    const insert = this.db.prepare(
      'INSERT OR IGNORE INTO monitored_files (assignment_id, path, kind, created_at) VALUES (?, ?, ?, ?)',
    );
    for (const t of targets) insert.run(id, t.path, t.kind, Date.now());
  }

  private map(r: AssignmentRow, targets: TargetRow[]): Assignment {
    return {
      id: r.id,
      name: r.name,
      module: r.module,
      description: r.description,
      deadline: r.deadline,
      targetWordCount: r.target_words,
      currentWordCount: r.current_words,
      estimatedHours: r.estimated_hours,
      notes: r.notes,
      archivedAt: r.archived_at,
      createdAt: r.created_at,
      isDemo: r.is_demo === 1,
      targets: targets.map(mapTarget),
    };
  }
}
