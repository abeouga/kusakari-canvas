import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { gardenApi } from "../api/gardens";
import { MAX_GARDEN_NAME_LENGTH } from "../domain/limits";
import { SiteHeader } from "../components/SiteHeader";
import { Dialog } from "../components/Dialog";
import { UiIcon } from "../components/UiIcon";
import { GardenCardMenu } from "../components/GardenCardMenu";
export function GardenListPage() {
  const queryClient = useQueryClient();
  const gardens = useQuery({
    queryKey: ["gardens"],
    queryFn: gardenApi.listGardens,
  });
  const [name, setName] = useState("");
  const [formError, setFormError] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [copyError, setCopyError] = useState("");
  const [copying, setCopying] = useState(false);
  const [openMenuId, setOpenMenuId] = useState(null);
  function closeMenu() {
    setOpenMenuId(null);
  }
  async function copyGarden(id) {
    if (copying) return;
    setCopying(true);
    setCopyError("");
    let created = null;
    try {
      const source = await gardenApi.getGarden(id);
      created = await gardenApi.createGarden({
        name: source.name.slice(0, 54) + "（複製）",
      });
      const document = {
        ...source,
        id: created.id,
        revision: created.revision,
        name: created.name,
      };
      document.objects = source.objects.map((object) => ({
        ...structuredClone(object),
        id: crypto.randomUUID(),
      }));
      await gardenApi.saveGarden(document);
      await queryClient.invalidateQueries({ queryKey: ["gardens"] });
    } catch (error) {
      let message = "庭を複製できませんでした。";
      if (error instanceof Error) message = error.message;
      if (created)
        message += " 作成済みの空の複製は一覧から確認・削除できます。";
      setCopyError(message);
      await queryClient.invalidateQueries({ queryKey: ["gardens"] });
    } finally {
      setCopying(false);
    }
  }
  const createGarden = useMutation({
    mutationFn: (request) => gardenApi.createGarden(request),
    onSuccess: async (document) => {
      await queryClient.invalidateQueries({ queryKey: ["gardens"] });
      window.location.assign(canvasUrl(`/gardens/${encodeURIComponent(document.id)}`));
    },
    onError: (error) =>
      setFormError(
        error instanceof Error ? error.message : "庭を作成できませんでした。",
      ),
  });
  const removeGarden = useMutation({
    mutationFn: gardenApi.deleteGarden,
    onSuccess: async () => {
      setDeleteTarget(null);
      await queryClient.invalidateQueries({ queryKey: ["gardens"] });
    },
  });
  const validName =
    name.trim().length > 0 && name.trim().length <= MAX_GARDEN_NAME_LENGTH;
  function submit(event) {
    event.preventDefault();
    setFormError(null);
    if (!validName) {
      setFormError(
        `庭の名前を1〜${MAX_GARDEN_NAME_LENGTH}文字で入力してください。`,
      );
      return;
    }
    createGarden.mutate({ name: name.trim() });
  }
  return (
    <div className="canvas-shell canvas-list-shell">
      <SiteHeader />
      <div className="page-shell">
        <main className="garden-list-layout">
          <section
            className="panel create-panel"
            aria-labelledby="create-heading"
          >
            <div className="section-heading">
              <h2 id="create-heading">
                <UiIcon name="plus" />
                新しい庭をつくる
              </h2>
              <p>まずは名前だけ。写真や庭の形は、あとから設定できます。</p>
            </div>
            <form className="create-form" onSubmit={submit}>
              <label className="field-label" htmlFor="garden-name">
                庭の名前
              </label>
              <input
                id="garden-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={MAX_GARDEN_NAME_LENGTH}
                placeholder="例：南側の庭"
                required
              />
              {formError && (
                <p className="notice notice-error" role="alert">
                  {formError}
                </p>
              )}
              {createGarden.isPending && (
                <p className="notice" role="status">
                  庭を作成しています…
                </p>
              )}
              <button
                className="button button-primary"
                type="submit"
                disabled={createGarden.isPending || !validName}
              >
                庭を作成
                <UiIcon name="arrow" size={16} />
              </button>
            </form>
          </section>

          {copyError && (
            <p className="notice notice-error" role="alert">
              {copyError}
            </p>
          )}
          {copying && (
            <p className="notice" role="status">
              庭を複製しています…
            </p>
          )}
          <section
            className="panel saved-panel"
            aria-labelledby="saved-heading"
          >
            <div className="section-heading section-heading-inline">
              <div>
                <h2 id="saved-heading">保存した庭</h2>
              </div>
              {gardens.data && (
                <span className="count-tag">{gardens.data.length}件</span>
              )}
            </div>
            {gardens.isLoading && (
              <p className="empty-message" role="status">
                庭を読み込んでいます…
              </p>
            )}
            {gardens.isError && (
              <div className="empty-message">
                <p className="notice notice-error" role="alert">
                  庭一覧を取得できませんでした。APIとMySQLの起動状態を確認してください。
                </p>
                <button
                  className="button button-secondary"
                  onClick={() => gardens.refetch()}
                >
                  再読み込み
                </button>
              </div>
            )}
            {gardens.data?.length === 0 && (
              <p className="empty-message">
                保存した庭はまだありません。上のフォームから最初の庭を作成できます。
              </p>
            )}
            {gardens.data && gardens.data.length > 0 && (
              <ul className="garden-cards">
                {gardens.data.map((garden) => (
                  <li className="garden-card" key={garden.id}>
                    <button
                      className="garden-card-open"
                      onClick={() =>
                        window.location.assign(
                          canvasUrl(`/gardens/${encodeURIComponent(garden.id)}`),
                        )
                      }
                    >
                      <span className="garden-thumb" aria-hidden="true">
                        <UiIcon name="polygon" size={30} />
                      </span>
                      <span className="garden-card-copy">
                        <strong>{garden.name}</strong>
                        <span>
                          {garden.width} × {garden.depth} m
                        </span>
                        <span>
                          最終保存{" "}
                          {new Date(garden.updatedAt).toLocaleString("ja-JP")}
                        </span>
                      </span>
                    </button>
                    <GardenCardMenu
                      name={garden.name}
                      open={openMenuId === garden.id}
                      disabled={copying || removeGarden.isPending}
                      onClose={closeMenu}
                      onToggle={() =>
                        setOpenMenuId(
                          openMenuId === garden.id ? null : garden.id,
                        )
                      }
                      onCopy={() => copyGarden(garden.id)}
                      onDelete={() => {
                        removeGarden.reset();
                        setDeleteTarget({ id: garden.id, name: garden.name });
                      }}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </main>
        <footer className="page-footer">
          kusakari {new Date().getFullYear()}
        </footer>
        {deleteTarget && (
          <Dialog
            title="この庭を削除しますか？"
            description="削除すると元に戻せません。"
            busy={removeGarden.isPending}
            onClose={() => setDeleteTarget(null)}
            footer={
              <>
                <button
                  type="button"
                  className="button button-secondary"
                  data-dialog-autofocus
                  disabled={removeGarden.isPending}
                  onClick={() => setDeleteTarget(null)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="button button-danger"
                  disabled={removeGarden.isPending}
                  onClick={() => removeGarden.mutate(deleteTarget.id)}
                >
                  {removeGarden.isPending ? "削除中…" : "庭を削除"}
                </button>
              </>
            }
          >
            <div className="confirmation-target">
              <UiIcon name="polygon" />
              <strong>{deleteTarget.name}</strong>
            </div>
            <p>庭の写真、輪郭、配置したすべての素材と生成履歴を削除します。</p>
            {removeGarden.isError && (
              <p className="notice notice-error" role="alert">
                削除できませんでした。接続を確認して再試行してください。
              </p>
            )}
          </Dialog>
        )}
      </div>
    </div>
  );
}
import { canvasUrl } from '../domain/urls';
