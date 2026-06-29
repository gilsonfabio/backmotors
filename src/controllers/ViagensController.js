const connection = require("../database/connection");
const moment = require("moment");
const admin = require("firebase-admin");
const fetch = require("node-fetch");

const serviceAccountBase64 = process.env.FIREBASE_CREDENTIALS;
if (!serviceAccountBase64) {
    throw new Error("A variável FIREBASE_CREDENTIALS_BASE64 não está definida!");
}

const serviceAccount = JSON.parse(Buffer.from(serviceAccountBase64, "base64").toString("utf-8"));

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
    });
}

async function enviarNotificacao(
    motorista,
    viagemId
) {
    const title = "Nova Viagem Solicitada!";
    const body = "Deseja aceitar esta corrida?";

    const notificationData = {
        screen: "travel",
        viagemId: viagemId.toString()
    };

    const expoPushToken =
      motorista.mottoken;

    if (
      expoPushToken &&
      expoPushToken.startsWith(
        "ExponentPushToken"
      )
    ) {

        await fetch(
          "https://exp.host/--/api/v2/push/send",
          {
            method: "POST",
            headers: {
              Accept:
                "application/json",
              "Accept-encoding":
                "gzip, deflate",
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              to: expoPushToken,
              title,
              body,
              data: notificationData,
            }),
          }
        );

        return true;
    }

    if (
      motorista.motFireToken
    ) {

        await admin
          .messaging()
          .send({
            token:
              motorista.motFireToken,
            notification: {
              title,
              body
            },
            data:
              notificationData
          });

        return true;
    }

    return false;
}

async function procurarProximoMotorista( viagemId) {
        const viagem = await connection("viagens")
            .where("viaId", viagemId)
            .first();

        if (!viagem) return;

        const result = await connection.raw(`
                SELECT
                    motId,
                    motNome,
                    mottoken,
                    motFireToken,
                    motLatAtual,
                    motLonAtual,
                    (
                        6371 *
                        ACOS(
                            COS(RADIANS(?))
                            * COS(RADIANS(motLatAtual))
                            * COS(
                                RADIANS(motLonAtual)
                                - RADIANS(?)
                            )
                            +
                            SIN(RADIANS(?))
                            * SIN(RADIANS(motLatAtual))
                        )
                    ) distancia
                FROM motoristas
                    WHERE motStatus = 'D'
                    AND motId NOT IN (
                        SELECT vmMotoristaId
                            FROM viagem_motoristas
                            WHERE vmViagemId = ?
                        )
                    ORDER BY distancia
                    LIMIT 1
                `, [
                    viagem.viaOriLat,
                    viagem.viaOriLon,
                    viagem.viaOriLat,
                    viagemId
                ]);

            const motorista = result[0]?.[0];

            if (!motorista) {
                await connection("viagens")
                    .where("viaId", viagemId)
                    .update({
                        viaStatus: "S"
                    });
                return;
            }

            await connection(
                "viagem_motoristas"
                ).insert({
                    vmViagemId: viagemId,
                    vmMotoristaId:
                    motorista.motId,
                    vmStatus: "P"
                });

            await enviarNotificacao(
                motorista,
                viagemId
            );

            iniciarTimeout(
                viagemId,
                motorista.motId
            );
        } 

function iniciarTimeout(
    viagemId,
    motoristaId
) {

    setTimeout(
        async () => {

            const convite =
                await connection(
                    "viagem_motoristas"
                )
                .where({
                    vmViagemId:
                        viagemId,

                    vmMotoristaId:
                        motoristaId
                })
                .first();

            if (
                !convite ||
                convite.vmStatus !== "P"
            ) {
                return;
            }

            await connection(
                "viagem_motoristas"
            )
            .where({
                vmViagemId:
                    viagemId,

                vmMotoristaId:
                    motoristaId
            })
            .update({
                vmStatus: "E"
            });

            await procurarProximoMotorista(
                viagemId
            );

        },

        15000
    );
}

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
            const { viaUsrId, viaOriLat, viaOriLon, viaOriDesc, viaDesLat, viaDesLon, viaDesDesc, viaDistancia, viaValor } = request.body;

            console.log("Recebendo requisição:", request.body);

            //let datAtual = new Date();
            //let datProcess = new Date(datAtual.getFullYear(), datAtual.getMonth(), datAtual.getDate());
            //let horProcess = moment().format("HH:mm:ss");

            const datProcess = moment().format("YYYY-MM-DD");
            const horProcess = moment().format("HH:mm:ss");
            let status = "A";

            console.log("DADOS RECEBIDOS:");
            console.log({
                viaDatSol: datProcess,
                viaHorSol: horProcess,
                viaUsrId,
                viaOriLat,
                viaOriLon,
                viaOriDesc,
                viaDesLat,
                viaDesLon,
                viaDesDesc,
                viaDistancia,
                viaValor,
                viaStatus: status,
            });

            const [viaId] = await connection("viagens").insert({
                viaDatSol: datProcess,
                viaHorSol: horProcess,
                viaUsrId,
                viaOriLat,
                viaOriLon,
                viaOriDesc,
                viaDesLat,
                viaDesLon,
                viaDesDesc,
                viaDistancia,
                viaValor,
                viaStatus: status,
            });

            const result = await connection.raw(`SELECT
                motId,
                motNome,
                mottoken,
                motFireToken,
                motLatAtual,
                motLonAtual,
                (
                    6371 *
                    ACOS(
                        COS(RADIANS(?))
                        * COS(RADIANS(motLatAtual))
                        * COS(
                            RADIANS(motLonAtual)
                            - RADIANS(?)
                        )
                        +
                        SIN(RADIANS(?))
                        * SIN(RADIANS(motLatAtual))
                    )
                ) AS distancia
                    FROM motoristas
                        WHERE motStatus = 'A'
                        ORDER BY distancia ASC
                        LIMIT 20
                `,
            [
                viaOriLat,
                viaOriLon,
                viaOriLat
            ]
            );

            const drivers = result[0] || result.rows || [];
            if (!drivers.length) {
                await connection("viagens")
                .where("viaId", viaId)
                .update({
                    viaStatus: "SEM_MOTORISTA"
                });

                return response.status(404).json({
                    error: "Nenhum motorista disponível"
                });
            }

            const motoristaAtual = drivers[0];

            await connection("viagem_motoristas").insert({
                vmViagemId: viaId,
                vmMotoristaId:
                motoristaAtual.motId,
                vmStatus: "PENDENTE"
            });

            await enviarNotificacao(
                motoristaAtual,
                viaId
            );

            return response.json({
                success: true,
                viagemId: viaId,
                motorista: motoristaAtual.motNome
            });
        } catch (error) {
            console.error(error);
            return response.status(500).json({
                error: error.message
            });
        }      
    },
    
    async aceitar(request, response ) {
        const {
            viagemId,
            motoristaId
        } = request.body;

        await connection("viagens")
            .where("viaId", viagemId)
            .update({
                viaMotId: motoristaId,
                viaStatus: "ACEITA"
            });

        await connection("viagem_motoristas")
            .where({
                vmViagemId: viagemId,
                vmMotoristaId: motoristaId
            })
            .update({
                vmStatus: "ACEITO"
            });

        await connection("motoristas")
            .where("motId", motoristaId)
            .update({
                motStatus: "O"
            });

        return response.json({success: true });
    },

    async recusar(request, response ) {
        const {
            viagemId,
            motoristaId
        } = request.body;

        await connection("viagem_motoristas")
            .where({
                vmViagemId: viagemId,
                vmMotoristaId: motoristaId
            })
            .update({
                vmStatus: "RECUSADO"
            });

        // Buscar próximo motorista

        const viagem = await connection("viagens")
            .where("viaId", viagemId)
            .first();

        const proximos = await connection.raw(`
            SELECT *
            FROM motoristas
            WHERE motStatus = 'D'
            AND motId NOT IN (
                SELECT vmMotoristaId
                FROM viagem_motoristas
                WHERE vmViagemId = ?
            )
            ORDER BY (
                6371 *
                ACOS(
                    COS(RADIANS(?))
                    * COS(RADIANS(motLatAtual))
                    * COS(
                        RADIANS(motLonAtual)
                        - RADIANS(?)
                    )
                    +
                    SIN(RADIANS(?))
                    * SIN(RADIANS(motLatAtual))
                )
            )
            LIMIT 1
                `, [
                viagemId,
                viagem.viaOriLat,
                viagem.viaOriLon,
                viagem.viaOriLat
            ]);

        const motorista = proximos[0]?.[0];
        if (!motorista) {
            await connection("viagens")
                .where("viaId", viagemId)
                .update({
                    viaStatus: "SEM_MOTORISTA"
                });

            return response.json({
                success: false
            });
        }

        await connection("viagem_motoristas").insert({
            vmViagemId: viagemId,
            vmMotoristaId: motorista.motId,
            vmStatus: "PENDENTE"
        });

        await enviarNotificacao(
            motorista,
            viagemId
        );

        return response.json({
            success: true
        });
    },

    async search(request, response) {
        const id = request.params.idVia;

        try {
            const travel = await connection("viagens")
            .where('viaId', id)
            .join('users', 'usrId', 'viagens.viaUsrId')
            .orderBy("viaId")
            .select(['viagens.*', 'users.usrNome', 'users.usrAvatar']);
            return response.json(travel);
        } catch (error) {
            return response.status(500).json({ error: error.message });
        }
    },
};