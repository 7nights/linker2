module.exports = {
  HANDSHAKE_INIT_VARS: 1,
  HANDSHAKE_REQUEST : 2,
  HANDSHAKE_RESPONSE: 3,
  HANDSHAKE_CONFIRMED: 4,
  PING: 5,
  ECHO: 6,
  IPLIST_REQUEST: 7,
  IPLIST_RESPONSE: 8,
  SYNC_REQUEST: 9,
  SYNC_RESPONSE: 10,
  DOWNLOAD: 11,
  DOWNLOAD_RESPONSE: 12,
  PULL_REQUEST: 13,

  /**
   * a hand for generating package body
   */
  BODY: {
    DOWNLOAD: function (session, path) {
      return new Buffer(JSON.stringify({
        session: session,
        path: path
      }));
    },
    SYNC_RESPONSE: function (renameList, list) {
      return new Buffer(JSON.stringify({
        renameList: renameList,
        list: list
      }));
    }
  }
};