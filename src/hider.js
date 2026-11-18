import * as THREE from 'three';

/**
 * 对方留下的“隐藏体”。若对方躲进了柜子/帘后，则整个人藏在里面看不见，
 * 只能靠 EMF 定位并逐个打开藏身处检查。
 */
export function createHider(parent, hidden, world) {
  const group = new THREE.Group();

  let spot = null;
  // 优先用躲藏时上报的 spotId，避免“站在柜子旁边也完全隐形”
  if (Number.isInteger(hidden.spotId) && hidden.spotId >= 0 && world.hideSpots[hidden.spotId]) {
    spot = world.hideSpots[hidden.spotId];
  } else if (hidden.spotId === undefined && !(hidden.y > 0.14)) {
    for (const s of world.hideSpots) {
      if (Math.hypot(s.x - hidden.x, s.z - hidden.z) < 0.85) {
        spot = s;
        break;
      }
    }
  }

  const gownMat = new THREE.MeshStandardMaterial({ color: 0x4d554e, roughness: 0.99 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0x5b4a3d, roughness: 0.9 });
  const hairMat = new THREE.MeshStandardMaterial({ color: 0x11100e, roughness: 1 });

  const parts = [];
  const add = (mesh) => {
    mesh.castShadow = true;
    group.add(mesh);
    parts.push(mesh);
    return mesh;
  };

  // 双腿
  for (const sx of [-0.105, 0.105]) {
    const leg = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.062, 0.5, 4, 8), gownMat));
    leg.position.set(sx, 0.4, 0);
    const foot = add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.2), skinMat));
    foot.position.set(sx, 0.045, 0.05);
  }

  // 病号服
  const gown = add(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 0.94, 16, 1, true), gownMat));
  gown.position.set(0, 1.0, 0);

  // 肩
  const shoulders = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.185, 0.16, 6, 12), gownMat));
  shoulders.position.set(0, 1.5, 0);

  // 手臂
  for (const sx of [-1, 1]) {
    const arm = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.052, 0.56, 4, 8), skinMat));
    arm.position.set(sx * 0.245, 1.2, 0.02);
    arm.rotation.z = sx * 0.055;
  }

  // 头
  const head = add(new THREE.Mesh(new THREE.SphereGeometry(0.125, 18, 14), skinMat));
  head.position.set(0, 1.75, 0.015);

  // 头发
  const hair = add(
    new THREE.Mesh(new THREE.SphereGeometry(0.132, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.62), hairMat),
  );
  hair.position.set(0, 1.765, 0.008);

  group.position.set(hidden.x, hidden.y ?? 0, hidden.z);
  group.rotation.y = (hidden.yaw || 0) + Math.PI;
  parent.add(group);

  const insideSpot = !!spot;
  if (insideSpot) group.visible = false;

  const position = new THREE.Vector3(hidden.x, hidden.y ?? 0, hidden.z);
  let t = Math.random() * 10;

  return {
    group,
    position,
    insideSpot,
    spot,
    found: false,
    update(dt) {
      if (!group.visible) return;
      t += dt;
      const breath = 1 + Math.sin(t * 1.9) * 0.014;
      gown.scale.set(1, breath, 1);
      shoulders.position.y = 1.5 + Math.sin(t * 1.9) * 0.006;
      head.position.y = 1.75 + Math.sin(t * 1.9 + 0.5) * 0.006;

      // 极罕见的抽搐
      if (Math.sin(t * 0.37 + 1.2) > 0.9985) {
        head.rotation.z = Math.sin(t * 26) * 0.16;
        head.rotation.x = Math.sin(t * 19) * 0.05;
      } else {
        head.rotation.z *= 0.86;
        head.rotation.x *= 0.86;
      }
    },
    reveal() {
      group.visible = true;
    },
    dispose() {
      group.traverse((o) => {
        if (o.isMesh) {
          o.geometry?.dispose();
          o.material?.dispose();
        }
      });
      group.removeFromParent();
    },
  };
}
