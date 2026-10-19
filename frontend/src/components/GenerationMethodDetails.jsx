export function GenerationMethodDetails({ generationMethod, width, height }) {
  let label = '不明';
  let description = 'この画像の生成方式は確認できません。';
  if (['full_frame_v1', 'full_frame_v2', 'full_frame_v3'].includes(generationMethod)) {
    label = 'AI生成画像を全体採用';
    description = 'AIが編集した庭全体の画像です。構図や植物の位置、背景・家具の形をBeforeと比べて確認してください。';
  }
  if (generationMethod === 'masked_composite_v1') {
    label = '旧方式：植物部分を合成';
    description = '植物の編集範囲だけを元のBeforeに重ねた画像です。編集範囲外を保持する旧方式で作成されています。';
  }
  return <div data-testid="generation-method-details" data-generation-method={generationMethod}>
    <p>生成方式：{label}</p>
    <p>{description}</p>
    {generationMethod === 'full_frame_v1' && (width < 1024 || height < 1024) && <p className="notice-error">
      この画像は旧処理で保存されています。Afterが画像の一部だけになっている場合は、修正後の処理で再生成してください。
    </p>}
  </div>;
}
