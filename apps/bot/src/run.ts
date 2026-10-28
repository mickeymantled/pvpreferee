import { main } from './cli';
import { diagnostic } from './types';

void main(process.env, process.argv.slice(2)).catch(error => {
  console.error(diagnostic(error));
  process.exitCode = 1;
});
