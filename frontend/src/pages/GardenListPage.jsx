import { gardenEntryUrl } from '../domain/urls';
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { gardenApi } from "../api/gardens";
import { ApiError } from "../api/http";
import { MAX_GARDEN_NAME_LENGTH } from "../domain/limits";
import { SiteHeader } from "../components/SiteHeader";
import { Dialog } from "../components/Dialog";
import { UiIcon } from "../components/UiIcon";
import { GardenCardMenu } from "../components/GardenCardMenu";
import { GardenThumbnail } from "../components/GardenThumbnail";
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
  const [copyRetryId, setCopyRetryId] = useState(null);
  const [openMenuId, setOpenMenuId] = useState(null);
  function closeMenu() {
    setOpenMenuId(null);
  }
  async function copyGarden(id) {
    if (copying) return;
    setCopying(true);
    setCopyError("");
    setCopyRetryId(null);
    try {
      // 複製はサーバーの1トランザクションで行い、失敗時に空の複製を残しません。
      await gardenApi.duplicateGarden(id);
    } catch (error) {
      setCopyError(
        error instanceof ApiError
          ? `庭を複製できませんでした。${error.message}`
          : "庭を複製できませんでした。接続を確認して再試行してください。",
      );
      setCopyRetryId(id);
    } finally {
      await queryClient.invalidateQueries({ queryKey: ["gardens"] });
      setCopying(false);
    }
  }
  const createGarden = useMutation({
    mutationFn: gardenApi.createGarden,
    onSuccess: async (document) => {
      await queryClient.invalidateQueries({ queryKey: ["gardens"] });
      window.location.assign(gardenEntryUrl(`/gardens/${encodeURIComponent(document.id)}`));
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
            <div className="notice notice-error" role="alert" data-testid="copy-error">
              <p>{copyError}</p>
              {copyRetryId && (
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={copying}
                  onClick={() => copyGarden(copyRetryId)}
                >
                  複製を再試行
                </button>
              )}
            </div>
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
                          gardenEntryUrl(`/gardens/${encodeURIComponent(garden.id)}`),
                        )
                      }
                    >
                      <GardenThumbnail garden={garden} />
                      <span className="garden-card-copy">
                        <strong>{garden.name}</strong>
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
