(function () {
  'use strict';

  var CENTER_01 = { x: 27.89, y: -11.37, z: -100.73 };
  var CENTER_02 = { x: 58.54, y: -14.24, z: -96.33 };
  var CENTER_03 = { x: 47.24, y: -16.42, z: -109.53 };

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = function () { reject(new Error('Impossible de charger ' + src)); };
      document.body.appendChild(script);
    });
  }

  function waitForVisit() {
    return new Promise(function (resolve) {
      function check() {
        if (document.documentElement.classList.contains('gl-ready') && window.__v3d && window.__v3d.scene && window.__v3d.THREE) resolve(window.__v3d);
        else requestAnimationFrame(check);
      }
      check();
    });
  }

  function base64ToArrayBuffer(value) {
    var binary = atob(value);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  function parseModel(THREE, key) {
    return new Promise(function (resolve, reject) {
      var encoded = window.OEUVRES_GLB && window.OEUVRES_GLB[key];
      if (!encoded) { reject(new Error('Données GLB manquantes : ' + key)); return; }
      new THREE.GLTFLoader().parse(base64ToArrayBuffer(encoded), '', function (gltf) {
        delete window.OEUVRES_GLB[key];
        resolve(gltf.scene);
      }, reject);
    });
  }

  function tuneMaterials(root, renderer, options) {
    options = options || {};
    root.traverse(function (node) {
      if (!node.isMesh) return;
      node.frustumCulled = true;
      var materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach(function (material) {
        if (!material) return;
        if (options.roughness != null) material.roughness = Math.max(options.roughness, material.roughness == null ? 1 : material.roughness);
        material.metalness = options.keepMetalness ? material.metalness : 0;
        material.envMapIntensity = options.envMapIntensity == null ? 0.15 : options.envMapIntensity;
        ['map', 'normalMap', 'roughnessMap', 'metalnessMap'].forEach(function (key) {
          if (material[key]) material[key].anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
        });
        material.needsUpdate = true;
      });
    });
  }

  function placeAtBase(THREE, root, scale, y) {
    var box = new THREE.Box3().setFromObject(root);
    var center = new THREE.Vector3();
    box.getCenter(center);
    root.scale.setScalar(scale);
    root.position.set(-center.x * scale, y - box.min.y * scale, -center.z * scale);
    return box;
  }

  function placeAtBaseXYZ(THREE, root, sx, sy, sz, y) {
    var box = new THREE.Box3().setFromObject(root);
    var center = new THREE.Vector3();
    box.getCenter(center);
    root.scale.set(sx, sy, sz);
    root.position.set(-center.x * sx, y - box.min.y * sy, -center.z * sz);
    return box;
  }

  function renameCartel(number, title) {
    var spots = document.querySelectorAll('.spot');
    for (var i = 0; i < spots.length; i++) {
      var label = spots[i].querySelector('b');
      if (label && new RegExp('Œuvre\\s*' + number, 'i').test(label.textContent || '')) {
        var text = spots[i].querySelector('span');
        if (text) text.textContent = title;
        spots[i].setAttribute('aria-label', 'Œuvre ' + number + ', ' + title + ', Anish Kapoor');
      }
    }
  }

  function addContactShadow(THREE, holder, sx, sz, opacity) {
    var material = new THREE.MeshBasicMaterial({ color: 0x120b0a, transparent: true, opacity: opacity, depthWrite: false, toneMapped: false });
    var shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 64), material);
    shadow.rotation.x = -Math.PI / 2;
    shadow.scale.set(sx, sz, 1);
    shadow.position.y = 0.012;
    shadow.renderOrder = 3;
    holder.add(shadow);
    return shadow;
  }

  function loadKakemonoTexture(THREE, renderer) {
    return new Promise(function (resolve, reject) {
      var image = new Image();
      image.onload = function () {
        var texture = new THREE.Texture(image);
        texture.encoding = THREE.sRGBEncoding;
        texture.flipY = true;
        texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
        texture.needsUpdate = true;
        resolve(texture);
      };
      image.onerror = function () { reject(new Error('Image du kakémono illisible')); };
      image.src = window.KAKEMONO_DATA || 'oeuvres/kakemono.png';
    });
  }

  function createKakemono(THREE, texture, name) {
    var group = new THREE.Group();
    group.name = name;

    var fabricGeometry = new THREE.PlaneGeometry(0.80, 1.98);
    var uv = fabricGeometry.attributes.uv;
    var u0 = 1840 / 4500, u1 = 2620 / 4500;
    var v0 = (3000 - 2510) / 3000, v1 = (3000 - 580) / 3000;
    for (var i = 0; i < uv.count; i++) {
      uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
    }
    uv.needsUpdate = true;
    var fabric = new THREE.Mesh(
      fabricGeometry,
      new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide })
    );
    fabric.name = name + ' — toile';
    fabric.position.set(0, 1.10, 0);
    group.add(fabric);

    var metal = new THREE.MeshStandardMaterial({ color: 0xb9b3aa, metalness: 0.72, roughness: 0.28 });
    var darkMetal = new THREE.MeshStandardMaterial({ color: 0x37312d, metalness: 0.32, roughness: 0.58 });
    var topRail = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.90, 16), metal);
    topRail.rotation.z = Math.PI / 2;
    topRail.position.set(0, 2.105, 0.012);
    group.add(topRail);

    var lowerRail = topRail.clone();
    lowerRail.position.y = 0.095;
    group.add(lowerRail);
    var base = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.09, 0.24), metal);
    base.position.y = 0.045;
    group.add(base);
    var foot = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.025, 0.38), darkMetal);
    foot.position.y = 0.0125;
    group.add(foot);

    addContactShadow(THREE, group, 0.54, 0.25, 0.24);
    return group;
  }

  function setupKakemonos(visit) {
    var THREE = visit.THREE;
    return loadKakemonoTexture(THREE, visit.renderer).then(function (texture) {
      var entranceLeft = createKakemono(THREE, texture, 'Kakémono entrée gauche');
      entranceLeft.position.set(25.15, 0.02, 1.05);
      entranceLeft.rotation.y = THREE.MathUtils.degToRad(6);

      var entranceRight = createKakemono(THREE, texture, 'Kakémono entrée droite');
      entranceRight.position.set(30.15, 0.02, 1.05);
      entranceRight.rotation.y = THREE.MathUtils.degToRad(-6);

      var tasting = createKakemono(THREE, texture, 'Kakémono entrée dégustation');
      tasting.position.set(49.65, -16.82, -119.10);
      tasting.rotation.y = THREE.MathUtils.degToRad(-12);

      visit.scene.add(entranceLeft, entranceRight, tasting);
      return { entranceLeft: entranceLeft, entranceRight: entranceRight, tasting: tasting, texture: texture };
    });
  }

  function setupOeuvre01(visit, artwork) {
    var THREE = visit.THREE;
    artwork.name = 'Oeuvre 01';
    var box = new THREE.Box3().setFromObject(artwork);
    var size = new THREE.Vector3();
    box.getSize(size);
    var scale = Math.min(0.95 / size.x, 2.55 / size.y, 0.95 / size.z);
    tuneMaterials(artwork, visit.renderer, { roughness: 0.76 });
    placeAtBase(THREE, artwork, scale, 0);

    var holder = new THREE.Group();
    holder.name = 'Installation Oeuvre 01';
    holder.position.set(CENTER_01.x, CENTER_01.y, CENTER_01.z);
    holder.add(artwork);
    addContactShadow(THREE, holder, 0.56, 0.56, 0.25);

    var ambient = new THREE.AmbientLight(0xffeee6, 0.14);
    ambient.name = 'Ambiance douce Oeuvre 01';
    var spot = new THREE.SpotLight(0xffe2cf, 4.1, 7.4, THREE.MathUtils.degToRad(25), 0.74, 1.25);
    spot.name = 'Douche lumineuse Oeuvre 01';
    spot.position.set(CENTER_01.x, -6.09, CENTER_01.z);
    spot.target.position.set(CENTER_01.x, CENTER_01.y + 1.25, CENTER_01.z);

    visit.scene.add(holder, ambient, spot, spot.target);
    renameCartel('01', 'Œuvre 01');
    return { holder: holder, artwork: artwork, spot: spot, ambient: ambient, bounds: box, scale: scale };
  }

  function setupOeuvre02(visit, artwork) {
    var THREE = visit.THREE;
    artwork.name = 'Oeuvre 02 — Ha-Makom — étude';
    var box = new THREE.Box3().setFromObject(artwork);
    var size = new THREE.Vector3();
    box.getSize(size);
    var scale = Math.min(6.35 / size.x, 7.15 / size.z, 3.35 / size.y, 1);
    tuneMaterials(artwork, visit.renderer, { roughness: 0.78 });
    placeAtBase(THREE, artwork, scale, 0);

    var holder = new THREE.Group();
    holder.name = 'Installation Oeuvre 02';
    holder.position.set(CENTER_02.x, CENTER_02.y, CENTER_02.z);
    holder.rotation.y = Math.PI;
    holder.add(artwork);
    addContactShadow(THREE, holder, 2.95, 3.42, 0.24);

    var ambient = new THREE.AmbientLight(0xffeee5, 0.22);
    ambient.name = 'Ambiance douce des œuvres';
    var spot = new THREE.SpotLight(0xffe1cb, 4.4, 11.5, THREE.MathUtils.degToRad(35), 0.72, 1.25);
    spot.name = 'Douche lumineuse Oeuvre 02';
    spot.position.set(CENTER_02.x, -7.69, CENTER_02.z);
    spot.target.position.set(CENTER_02.x, CENTER_02.y + 0.65, CENTER_02.z);

    visit.scene.add(holder, ambient, spot, spot.target);
    renameCartel('02', 'Ha-Makom — étude');
    return { holder: holder, artwork: artwork, spot: spot, ambient: ambient, bounds: box, scale: scale };
  }

  function setupOeuvre03(visit, sculpture, bottle) {
    var THREE = visit.THREE;
    sculpture.name = 'Oeuvre 03 — Sable rouge — étude';
    bottle.name = 'Bouteille Ruinart — fermée';
    tuneMaterials(sculpture, visit.renderer, { roughness: 0.72 });
    tuneMaterials(bottle, visit.renderer, { keepMetalness: true, envMapIntensity: 0.35 });

    // L'emprise en profondeur reste contenue sur le socle, tandis que la hauteur et la largeur
    // visibles sont amplifiées pour que l'œuvre occupe réellement la niche.
    placeAtBaseXYZ(THREE, sculpture, 0.105, 0.20, 0.20, 0);
    placeAtBase(THREE, bottle, 0.069, 0.82);
    // Le fond est légèrement pris dans le trou rond ; la bouteille fermée en ressort vers le haut.
    bottle.position.x += 0.18;
    bottle.position.z += 0.06;
    bottle.rotation.x = THREE.MathUtils.degToRad(-15);

    var holder = new THREE.Group();
    holder.name = 'Installation Oeuvre 03 avec bouteille Ruinart';
    holder.position.set(CENTER_03.x, CENTER_03.y, CENTER_03.z);
    holder.add(sculpture, bottle);
    addContactShadow(THREE, holder, 0.40, 0.40, 0.28);

    var spot = new THREE.SpotLight(0xffdcc2, 3.6, 5.2, THREE.MathUtils.degToRad(24), 0.76, 1.3);
    spot.name = 'Douche lumineuse Oeuvre 03';
    spot.position.set(CENTER_03.x, -13.74, CENTER_03.z);
    spot.target.position.set(CENTER_03.x, CENTER_03.y + 0.58, CENTER_03.z);
    visit.scene.add(holder, spot, spot.target);
    renameCartel('03', 'Sable rouge — étude');

    return { holder: holder, sculpture: sculpture, bottle: bottle, spot: spot };
  }

  waitForVisit().then(function (visit) {
    var THREE = visit.THREE;
    var loaderReady = THREE.GLTFLoader ? Promise.resolve() : loadScript('oeuvres/GLTFLoader.js');
    return loaderReady.then(function () {
      var files = [
        ['01', 'oeuvres/oeuvre-01-data.js'],
        ['02', 'oeuvres/oeuvre-02-data.js'],
        ['03', 'oeuvres/oeuvre-03-data.js'],
        ['03-bottle-closed', 'oeuvres/bouteille-fermee-data.js']
      ];
      var modelDataReady = files.map(function (entry) {
        return window.OEUVRES_GLB && window.OEUVRES_GLB[entry[0]] ? Promise.resolve() : loadScript(entry[1]);
      });
      modelDataReady.push(window.KAKEMONO_DATA ? Promise.resolve() : loadScript('oeuvres/kakemono-data.js'));
      return Promise.all(modelDataReady);
    }).then(function () {
      return setupKakemonos(visit).then(function (kakemonos) {
       return parseModel(THREE, '01').then(function (artwork01) {
        var result01 = setupOeuvre01(visit, artwork01);
        return parseModel(THREE, '02').then(function (artwork02) {
          var result02 = setupOeuvre02(visit, artwork02);
          return parseModel(THREE, '03').then(function (sculpture) {
            return parseModel(THREE, '03-bottle-closed').then(function (bottle) {
              var result03 = setupOeuvre03(visit, sculpture, bottle);
              window.__oeuvres = { oeuvre01: result01, oeuvre02: result02, oeuvre03: result03, kakemonos: kakemonos };
              window.__oeuvre01 = result01;
              window.__oeuvre02 = result02;
              window.__oeuvre03 = result03;
              console.info('Œuvres 01, 02 et 03 chargées', { oeuvre01Triangles: 242372, oeuvre02Triangles: 179999, oeuvre03Triangles: 220192, bottleTriangles: 180000, bottleState: 'fermée' });
            });
          });
        });
      });
      });
    });
  }).catch(function (error) {
    console.error('Initialisation des œuvres impossible', error);
  });
})();
