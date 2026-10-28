import { hashPassword } from '../server/auth-core';

// Supply via redirected stdin, never an argument or shell-history literal.
let password = '';
for await (const chunk of process.stdin) {
  password += String(chunk);
  if (Buffer.byteLength(password) > 1026) throw new Error('Password input too long');
}
try { console.log(await hashPassword(password.replace(/\r?\n$/, ''))); }
catch { console.error('Provide a password of 16–1024 bytes via stdin.'); process.exitCode = 1; }
