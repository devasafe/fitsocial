import mongoose from "mongoose";
import { env } from "./env.js";

export async function connectDB(): Promise<void> {
  mongoose.set("strictQuery", true);

  // Índice que falha ao ser criado precisa APARECER.
  //
  // O mongoose cria os índices sozinho no boot e engole o erro: ele mesmo faz
  // `model.init().catch(noop)`, o que marca o erro como tratado e impede o
  // evento de chegar a quem escuta. Sem este listener, um índice único que não
  // pôde ser criado por causa de dado duplicado simplesmente não existe — e o
  // sintoma aparece semanas depois, em outro lugar, sem nada no log ligando as
  // duas coisas. Foi assim com o índice do recorde por slug.
  for (const model of Object.values(mongoose.models)) {
    model.on("index", (err: Error | undefined) => {
      if (err) console.error(`[db] índice de ${model.modelName} NÃO foi criado: ${err.message}`);
    });
  }

  await mongoose.connect(env.mongoUri);
  console.log("[db] Conectado ao MongoDB");
}

export async function disconnectDB(): Promise<void> {
  await mongoose.disconnect();
}
