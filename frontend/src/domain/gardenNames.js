export const DEFAULT_GARDEN_NAME = '新しい庭';

/**
 * 一覧で区別できるよう、既存の庭と重ならない既定名を返します（「新しい庭」「新しい庭 2」…）。
 * @param {{name: string}[]} gardens
 */
export function nextDefaultGardenName(gardens) {
    const names = new Set(gardens.map((garden) => garden.name));
    if (!names.has(DEFAULT_GARDEN_NAME)) return DEFAULT_GARDEN_NAME;
    let number = 2;
    while (names.has(`${DEFAULT_GARDEN_NAME} ${number}`)) number += 1;
    return `${DEFAULT_GARDEN_NAME} ${number}`;
}
