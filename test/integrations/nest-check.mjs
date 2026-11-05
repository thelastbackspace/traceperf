// Run by integrations.test.ts in a plain Node process (NestJS 12 is ESM-only).
import 'reflect-metadata';
import { Controller, Get, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createTracePerf, nestInterceptor } from '../../dist/esm/index.js';

const roots = [];
const tp = createTracePerf({ silent: true, trackMemory: false, onComplete: r => roots.push(r) });
const sleep = ms => new Promise(r => setTimeout(r, ms));

class UsersController {
  async findOne() {
    await tp.track(() => sleep(5), { label: 'db.nestUser' });
    return { ok: true };
  }
}
Controller('users')(UsersController);
Get(':id')(UsersController.prototype, 'findOne', Object.getOwnPropertyDescriptor(UsersController.prototype, 'findOne'));
class AppModule {}
Module({ controllers: [UsersController] })(AppModule);

const app = await NestFactory.create(AppModule, { logger: false });
app.useGlobalInterceptors(nestInterceptor(tp));
await app.listen(0, '127.0.0.1');
const { port } = app.getHttpServer().address();
const body = await (await fetch(`http://127.0.0.1:${port}/users/7`)).json();
for (let i = 0; i < 100 && roots.length === 0; i++) await sleep(5);
await app.close();
console.log(JSON.stringify({ body, label: roots[0]?.label, children: roots[0]?.children.map(c => c.label) }));
