// M-1: 時刻の取得元。Date.now() を呼ぶのはこのファイルだけにする（NFR-7、CD-1）。

/** 呼ぶたびに現在の瞬間を UTC 基準のエポックからのミリ秒で返す。 */
export type Clock = () => number;

/** 本番の取得元。OS の時計の値をそのまま返す（TS-1）。 */
export const systemClock: Clock = () => Date.now();
