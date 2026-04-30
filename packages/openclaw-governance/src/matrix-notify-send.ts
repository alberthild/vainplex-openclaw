export function sendMatrixNotification(params: {
  homeserverUrl: string;
  accessToken: string;
  roomId: string;
  message: string;
}): Promise<Response> {
  const txnId = `gov2fa_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const url = `${params.homeserverUrl}/_matrix/client/v3/rooms/${encodeURIComponent(params.roomId)}/send/m.room.message/${txnId}`;
  return fetch(url, {
    method: "PUT",
    headers: {
      "Authorization": `Bearer ${params.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ msgtype: "m.text", body: params.message }),
  });
}
