import { spawn } from 'node:child_process';

console.log('\x1b[36m%s\x1b[0m', '✨ Starting Echoes ChatBot (Backend + Frontend)...');

const backend = spawn('npm', ['run', 'dev', '--prefix', 'backend'], {
  stdio: 'inherit',
  shell: true,
});

const frontend = spawn('npm', ['run', 'dev', '--prefix', 'frontend'], {
  stdio: 'inherit',
  shell: true,
});

const cleanup = () => {
  console.log('\n\x1b[33m%s\x1b[0m', 'Shutting down services...');
  backend.kill('SIGINT');
  frontend.kill('SIGINT');
  process.exit();
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
