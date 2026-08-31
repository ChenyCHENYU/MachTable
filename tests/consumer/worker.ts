import {
  createWorkerDataProcessor,
  installGridDataWorker,
  processFieldDataRequest,
  type GridDataProcessor
} from "@agile-team/mach-table/worker";
import { createWorkerDataProcessor as createVueWorkerProcessor } from "@agile-team/mach-table-vue/worker";
import { createWorkerDataProcessor as createReactWorkerProcessor } from "@agile-team/mach-table-react/worker";

interface Row { id: string; amount: number }

export const processor: GridDataProcessor<Row> = createWorkerDataProcessor<Row>(() => new Worker("worker.js"));
export const adapterFactories = [createVueWorkerProcessor, createReactWorkerProcessor];
export const workerUtilities = [installGridDataWorker, processFieldDataRequest];
