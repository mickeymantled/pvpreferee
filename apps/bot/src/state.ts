import { createHash, randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { mkdir, open, readFile, rename, unlink, realpath, lstat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { BotError, isId, type State } from './types';

const checksum = (state: State) => createHash('sha256').update(JSON.stringify(state)).digest('hex');
function validate(state: State, mode: State['mode']): void {
  const fail = () => { throw new BotError('STATE_INVALID', 'State is corrupt or belongs to a different mode. Restore its backup; do not reset a send cursor.'); };
  if (!state || state.version !== 1 || state.mode !== mode || typeof state.jobs !== 'object' || !state.jobs ||
    !Array.isArray(state.attempts) || !Number.isFinite(state.blockedUntil) || typeof state.accountId !== 'string') fail();
  if (state.accountId && !isId(state.accountId) || state.sinceId !== undefined && !isId(state.sinceId)) fail();
  if (state.scan && (!isId(state.scan.untilId) || !Array.isArray(state.scan.tokens) ||
    state.scan.sinceId !== undefined && !isId(state.scan.sinceId) || state.scan.highId !== undefined && !isId(state.scan.highId))) fail();
  for (const [id, job] of Object.entries(state.jobs)) {
    if (!isId(id) || job.post?.id !== id || typeof job.post.text !== 'string' ||
      !['queued', 'pending', 'submitted', 'sent', 'skipped', 'failed', 'dry_run'].includes(job.status) ||
      !Number.isSafeInteger(job.attempts) || job.attempts < 0 || !Number.isFinite(job.nextAttemptAt)) fail();
    if (['pending', 'submitted'].includes(job.status) && (!job.prepared || typeof job.prepared.text !== 'string')) fail();
    if (job.status === 'sent' && !isId(job.replyId)) fail();
  }
  if (state.attempts.some(attempt => !Number.isFinite(attempt.at) || !isId(attempt.authorId))) fail();
}
/** Single-writer POSIX store. A crash leaves the lock for explicit operator recovery. */
export class StateStore {
  private closed = false;
  private poisoned = false;
  private constructor(readonly path: string, readonly data: State, private readonly lockPath: string) {}

  static async open(path: string, mode: State['mode'], sinceId?: string): Promise<StateStore> {
    await mkdir(dirname(resolve(path)), { recursive: true, mode: 0o700 });
    const directory = await realpath(dirname(resolve(path)));
    const target = join(directory, basename(path));
    try { if ((await lstat(target)).isSymbolicLink()) throw new BotError('STATE_SYMLINK', 'State must be a regular local file.'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const lockPath = `${target}.lock`;
    let lock;
    try { lock = await open(lockPath, 'wx', 0o600); }
    catch { throw new BotError('STATE_LOCKED', 'State lock exists. Stop the other worker, or verify the recorded PID/host is dead before removing only this lock.'); }
    try {
      await lock.writeFile(JSON.stringify({ pid: process.pid, host: hostname(), at: new Date().toISOString() }));
      await lock.sync();
    } finally { await lock.close(); }
    try {
      let state: State;
      try {
        const envelope = JSON.parse(await readFile(target, 'utf8')) as { checksum: string; state: State };
        if (envelope.checksum !== checksum(envelope.state)) throw new Error('Checksum');
        state = envelope.state;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new BotError('STATE_INVALID', 'Cannot read intact state. Restore a backup; never discard uncertain submissions.');
        state = { version: 1, mode, accountId: '', sinceId, jobs: {}, attempts: [], blockedUntil: 0 };
      }
      validate(state, mode);
      const store = new StateStore(target, state, lockPath);
      await store.save();
      return store;
    } catch (error) { await unlink(lockPath); throw error; }
  }

  async save(): Promise<void> {
    if (this.closed || this.poisoned) throw new BotError('STATE_IO', 'State is unavailable; stop and inspect storage before restarting.');
    validate(this.data, this.data.mode);
    const temp = `${this.path}.${randomUUID()}.tmp`;
    try {
      const file = await open(temp, 'wx', 0o600);
      try { await file.writeFile(JSON.stringify({ checksum: checksum(this.data), state: this.data })); await file.sync(); }
      finally { await file.close(); }
      await rename(temp, this.path);
      const directory = await open(dirname(this.path), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    } catch {
      this.poisoned = true;
      throw new BotError('STATE_IO', 'Atomic state write failed. Stop and inspect storage; uncertain posts must not be resent.');
    } finally { await unlink(temp).catch(() => undefined); }
  }

  async reconcile(mentionId: string, replyId: string | null): Promise<void> {
    const job = this.data.jobs[mentionId];
    if (!job || job.status !== 'submitted' || replyId !== null && !isId(replyId)) {
      throw new BotError('RECONCILE', 'Choose a submitted mention and a verified reply ID, or abandon it without resending.');
    }
    job.status = replyId ? 'sent' : 'skipped';
    job.replyId = replyId ?? undefined;
    job.code = 'OPERATOR_RECONCILED';
    if (job.prepared) delete job.prepared.png;
    await this.save();
  }

  async pruneTerminal(): Promise<number> {
    let removed = 0;
    if (!this.data.sinceId) return removed;
    for (const [id, job] of Object.entries(this.data.jobs)) {
      if (BigInt(id) <= BigInt(this.data.sinceId) && ['sent', 'skipped', 'dry_run'].includes(job.status)) {
        delete this.data.jobs[id]; removed++;
      }
    }
    await this.save();
    return removed;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    // On an uncertain durability failure retain the lock, making recovery deliberate.
    if (!this.poisoned) await unlink(this.lockPath);
  }
}
