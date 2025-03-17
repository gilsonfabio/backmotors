const connection = require("../database/connection");
const moment = require("moment");
const admin = require("firebase-admin");
const fetch = require("node-fetch"); // Para chamadas API do Expo

// Inicializar Firebase Admin SDK
//admin.initializeApp({
//  credential: admin.credential.cert(require("../../serviceAccountKey.json")),
//});


const serviceAccountBase64 = process.env.FIREBASE_CREDENTIALS;
if (!serviceAccountBase64) {
  throw new Error("A variável FIREBASE_CREDENTIALS_BASE64 não está definida!");
}

const serviceAccount = JSON.parse(Buffer.from(serviceAccountBase64, "base64").toString("utf-8"));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});


//const serviceAccount = JSON.parse(Buffer.from(process.env.FIREBASE_CREDENTIALS, "base64").toString("utf8"));

// Inicializar o Firebase Admin SDK
//admin.initializeApp({
//  credential: admin.credential.cert(serviceAccount),
//});

module.exports = {
  async index(request, response) {
    try {
      const viagens = await connection("viagens").orderBy("viaId").select("*");
      return response.json(viagens);
    } catch (error) {
      return response.status(500).json({ error: error.message });
    }
  },

  async create(request, response) {
    try {
      const { viaUsrId, viaOriLat, viaOriLon, viaDesLat, viaDesLon, viaDistancia, motorista } = request.body;

      console.log("Recebendo requisição:", request.body);

      let datAtual = new Date();
      let datProcess = new Date(datAtual.getFullYear(), datAtual.getMonth(), datAtual.getDate());
      let horProcess = moment().format("HH:mm:ss");

      let status = "A";

      // Inserindo no banco
      const [viaId] = await connection("viagens").insert({
        viaDatSol: datProcess,
        viaHorSol: horProcess,
        viaUsrId,
        viaOriLat,
        viaOriLon,
        viaDesLat,
        viaDesLon,
        viaDistancia,
        viaStatus: status,
      });

      // Buscando motorista
      const driver = await connection("motoristas").where("motId", motorista).select("*").first();
      if (!driver) {
        return response.status(404).json({ error: "Motorista não encontrado" });
      }

      console.log("Motorista encontrado");

      let expoPushToken = driver.mottoken;
      if (!expoPushToken) {
        return response.status(400).json({ error: "Token de notificação não encontrado para o motorista" });
      }

      console.log("Token recebido:", expoPushToken);

      let title = "Nova Viagem Solicitada!";
      let body = "Um passageiro solicitou uma viagem. Confira no app!";

      if (expoPushToken.startsWith("ExponentPushToken")) {
        // Enviar notificação via Expo API
        const expoResponse = await fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Accept-encoding": "gzip, deflate",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            to: expoPushToken,
            title: title,
            body: body,
          }),
        });

        const expoData = await expoResponse.json();
        console.log("Resposta do Expo:", expoData);

        return response.json({ success: true, message: "Notificação enviada via Expo!" });
      } else {
        // Enviar via Firebase Cloud Messaging (FCM)
        const message = {
          token: expoPushToken,
          notification: { title, body },
        };

        try {
          await admin.messaging().send(message);
          console.log("Notificação enviada via FCM!");
          return response.json({ success: true, message: "Notificação enviada via Firebase!" });
        } catch (error) {
          console.error("Erro ao enviar notificação via Firebase:", error);
          return response.status(500).json({ error: "Erro ao enviar notificação via Firebase" });
        }
      }
    } catch (error) {
      console.error("Erro no servidor:", error);
      return response.status(500).json({ error: error.message });
    }
  },
};
