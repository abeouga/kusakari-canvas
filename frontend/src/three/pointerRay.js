import { PerspectiveCamera, Raycaster, Vector3 } from 'three';

/** @param {{clientX: number, clientY: number}} event @param {HTMLElement} canvas */
export function canvasPointer(event, canvas) {
    const bounds = canvas.getBoundingClientRect();
    return { x: (event.clientX - bounds.left) / bounds.width * 2 - 1,
        y: -(event.clientY - bounds.top) / bounds.height * 2 + 1 };
}

/** Ray construction for both calibrated and legacy projective photo cameras.
 * @param {import('three').Raycaster} raycaster
 * @param {{x: number, y: number}} pointer
 * @param {import('three').Camera} camera
 */
export function setPhotoRay(raycaster, pointer, camera) {
    if (camera instanceof PerspectiveCamera) {
        Raycaster.prototype.setFromCamera.call(raycaster, /** @type {import('three').Vector2} */ (pointer), camera);
        return;
    }
    const farPoint = new Vector3(pointer.x, pointer.y, 0.0001).unproject(camera);
    raycaster.ray.origin.set(pointer.x, pointer.y, 0).unproject(camera);
    raycaster.ray.direction.copy(farPoint).sub(raycaster.ray.origin).normalize();
    // Legacy projection is not a standard orthographic matrix. Sampling around
    // the depth centre avoids crossing its projective infinity.
    raycaster.ray.origin.addScaledVector(raycaster.ray.direction, -/** @type {import('three').OrthographicCamera} */ (camera).far);
    raycaster.camera = camera;
}
