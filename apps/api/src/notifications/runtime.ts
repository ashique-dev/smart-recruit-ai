import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { Infrastructure, redisOptions } from '../common/infrastructure';
import { digest } from '../auth/security';
import { Notifications } from './notifications';
@Injectable()
export class NotificationRuntime implements OnModuleInit,OnModuleDestroy {
 private queue?:Queue;
 private worker?:Worker;
 private timer?:NodeJS.Timeout;
 private maintenanceTimer?:NodeJS.Timeout;
 private maintenance?:Promise<void>;
 private stopping=false;
 private poll?:Promise<void>;
 constructor(private readonly infra:Infrastructure,private readonly notifications:Notifications) {}
 async onModuleInit() {
  const connection=redisOptions(this.infra.env.REDIS_URL);
  const prefix=`sr-${digest(new URL(this.infra.env.DATABASE_URL).pathname).slice(0,16)}`;
  this.queue=new Queue('notifications',{prefix,connection:{...connection,commandTimeout:2000,maxRetriesPerRequest:1,enableOfflineQueue:false}});
  this.worker=new Worker('notifications',job=>this.notifications.process(job.data),{prefix,connection,concurrency:4});
  this.queue.on('error',()=>{}); this.worker.on('error',()=>{});
  this.tick();
  this.maintain();
 }
 private maintain() {
  if(this.stopping) return;
  // Never await Redis dispatch before scheduling the next expiry batch.
  this.maintenance=this.notifications.sweepExpired().then(()=>{}).catch(()=>{
   // A DB failure leaves the expired set eligible for the next bounded pass.
  }).finally(()=>{if(!this.stopping) this.maintenanceTimer=setTimeout(()=>this.maintain(),1000);});
 }
 private tick() {
  if(this.stopping) return;
  this.poll=this.dispatch().catch(()=>{/* Durable rows remain due; health/DB states expose recovery. */}).finally(()=>{if(!this.stopping) this.timer=setTimeout(()=>this.tick(),1000);});
 }
 async dispatch() {
  for(const job of await this.notifications.reconcile()) {
   if(this.stopping) break;
   if(!await this.notifications.leaseDispatch(job)) continue;
   try {
    await this.queue!.add('deliver',job,{jobId:`delivery-${job.deliveryId}`,removeOnComplete:true,removeOnFail:true,attempts:1});
    await this.notifications.published(job);
   } catch {/* Polling resumes from DB; no raw error or payload logging. */}
  }
 }
 isReady() {return Boolean(this.worker?.isRunning());}
 async onModuleDestroy() {this.stopping=true;clearTimeout(this.timer);clearTimeout(this.maintenanceTimer);await Promise.all([this.poll,this.maintenance]);await this.worker?.close();await this.queue?.close();}
}
