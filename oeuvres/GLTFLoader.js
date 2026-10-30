(function (THREE) {
  'use strict';

  if (!THREE || THREE.GLTFLoader) return;

  var COMPONENTS = {
    5120: Int8Array,
    5121: Uint8Array,
    5122: Int16Array,
    5123: Uint16Array,
    5125: Uint32Array,
    5126: Float32Array
  };
  var ITEMS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

  function decodeJson(bytes) {
    if (window.TextDecoder) return new TextDecoder('utf-8').decode(bytes);
    var out = '', chunk = 32768;
    for (var i = 0; i < bytes.length; i += chunk) out += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    return decodeURIComponent(escape(out));
  }

  function readGlb(buffer) {
    var view = new DataView(buffer);
    if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) throw new Error('GLB 2.0 invalide');
    var offset = 12, json = null, binOffset = 0;
    while (offset < buffer.byteLength) {
      var length = view.getUint32(offset, true);
      var type = view.getUint32(offset + 4, true);
      offset += 8;
      if (type === 0x4e4f534a) json = JSON.parse(decodeJson(new Uint8Array(buffer, offset, length)));
      if (type === 0x004e4942) binOffset = offset;
      offset += length;
    }
    if (!json || !binOffset) throw new Error('Chunks JSON/BIN manquants');
    return { json: json, binOffset: binOffset };
  }

  function loadImage(buffer, start, length, mime) {
    return new Promise(function (resolve, reject) {
      var blob = new Blob([new Uint8Array(buffer, start, length)], { type: mime || 'image/png' });
      var url = URL.createObjectURL(blob);
      var image = new Image();
      image.onload = function () { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Image GLB illisible')); };
      image.src = url;
    });
  }

  function accessorAttribute(doc, buffer, binOffset, accessorIndex) {
    var a = doc.accessors[accessorIndex];
    var bv = doc.bufferViews[a.bufferView];
    var Type = COMPONENTS[a.componentType];
    var size = ITEMS[a.type];
    var byteOffset = binOffset + (bv.byteOffset || 0) + (a.byteOffset || 0);
    var normalized = !!a.normalized;
    if (bv.byteStride && bv.byteStride !== Type.BYTES_PER_ELEMENT * size) {
      var ib = new THREE.InterleavedBuffer(new Type(buffer, binOffset + (bv.byteOffset || 0), bv.byteLength / Type.BYTES_PER_ELEMENT), bv.byteStride / Type.BYTES_PER_ELEMENT);
      return new THREE.InterleavedBufferAttribute(ib, size, (a.byteOffset || 0) / Type.BYTES_PER_ELEMENT, normalized);
    }
    return new THREE.BufferAttribute(new Type(buffer, byteOffset, a.count * size), size, normalized);
  }

  function GLTFLoader() {}

  GLTFLoader.prototype.parse = function (data, path, onLoad, onError) {
    try {
      var parsed = readGlb(data);
      var doc = parsed.json;
      var buffer = data;
      var binOffset = parsed.binOffset;
      var imagePromises = (doc.images || []).map(function (image) {
        var bv = doc.bufferViews[image.bufferView];
        return loadImage(buffer, binOffset + (bv.byteOffset || 0), bv.byteLength, image.mimeType);
      });

      Promise.all(imagePromises).then(function (images) {
        var textures = (doc.textures || []).map(function (textureDef) {
          var texture = new THREE.Texture(images[textureDef.source]);
          texture.flipY = false;
          texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
          texture.minFilter = THREE.LinearMipmapLinearFilter;
          texture.magFilter = THREE.LinearFilter;
          texture.generateMipmaps = true;
          texture.needsUpdate = true;
          return texture;
        });

        function materialAt(index) {
          var def = (doc.materials || [])[index] || {};
          var pbr = def.pbrMetallicRoughness || {};
          var color = pbr.baseColorFactor || [1, 1, 1, 1];
          var params = {
            color: new THREE.Color(color[0], color[1], color[2]),
            opacity: color[3],
            transparent: color[3] < 1 || def.alphaMode === 'BLEND',
            alphaTest: def.alphaMode === 'MASK' ? (def.alphaCutoff == null ? 0.5 : def.alphaCutoff) : 0,
            side: def.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
            metalness: pbr.metallicFactor == null ? 1 : pbr.metallicFactor,
            roughness: pbr.roughnessFactor == null ? 1 : pbr.roughnessFactor
          };
          if (pbr.baseColorTexture) {
            params.map = textures[pbr.baseColorTexture.index];
            params.map.encoding = THREE.sRGBEncoding;
          }
          if (pbr.metallicRoughnessTexture) {
            params.metalnessMap = textures[pbr.metallicRoughnessTexture.index];
            params.roughnessMap = textures[pbr.metallicRoughnessTexture.index];
          }
          if (def.normalTexture) {
            params.normalMap = textures[def.normalTexture.index];
            params.normalScale = new THREE.Vector2(def.normalTexture.scale == null ? 1 : def.normalTexture.scale, def.normalTexture.scale == null ? 1 : def.normalTexture.scale);
          }
          var material = new THREE.MeshStandardMaterial(params);
          material.name = def.name || '';
          return material;
        }

        var materials = (doc.materials || []).map(function (_, i) { return materialAt(i); });
        var meshDefs = doc.meshes || [];
        var meshes = meshDefs.map(function (meshDef) {
          var group = new THREE.Group();
          group.name = meshDef.name || '';
          (meshDef.primitives || []).forEach(function (primitive) {
            var geometry = new THREE.BufferGeometry();
            var attrs = primitive.attributes || {};
            if (attrs.POSITION != null) geometry.setAttribute('position', accessorAttribute(doc, buffer, binOffset, attrs.POSITION));
            if (attrs.NORMAL != null) geometry.setAttribute('normal', accessorAttribute(doc, buffer, binOffset, attrs.NORMAL));
            if (attrs.TEXCOORD_0 != null) geometry.setAttribute('uv', accessorAttribute(doc, buffer, binOffset, attrs.TEXCOORD_0));
            if (primitive.indices != null) geometry.setIndex(accessorAttribute(doc, buffer, binOffset, primitive.indices));
            geometry.computeBoundingBox();
            geometry.computeBoundingSphere();
            var mesh = new THREE.Mesh(geometry, materials[primitive.material] || new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }));
            mesh.name = meshDef.name || '';
            group.add(mesh);
          });
          return group;
        });

        var nodes = (doc.nodes || []).map(function (nodeDef) {
          var object = nodeDef.mesh == null ? new THREE.Group() : meshes[nodeDef.mesh].clone();
          object.name = nodeDef.name || '';
          if (nodeDef.matrix) object.applyMatrix4(new THREE.Matrix4().fromArray(nodeDef.matrix));
          else {
            if (nodeDef.translation) object.position.fromArray(nodeDef.translation);
            if (nodeDef.rotation) object.quaternion.fromArray(nodeDef.rotation);
            if (nodeDef.scale) object.scale.fromArray(nodeDef.scale);
          }
          return object;
        });
        (doc.nodes || []).forEach(function (nodeDef, i) {
          (nodeDef.children || []).forEach(function (child) { nodes[i].add(nodes[child]); });
        });
        var sceneDef = (doc.scenes || [])[doc.scene || 0] || { nodes: [] };
        var scene = new THREE.Group();
        scene.name = 'GLTFScene';
        (sceneDef.nodes || []).forEach(function (index) { scene.add(nodes[index]); });
        onLoad({ scene: scene, scenes: [scene], animations: [], cameras: [], asset: doc.asset || {} });
      }).catch(function (error) { if (onError) onError(error); else throw error; });
    } catch (error) {
      if (onError) onError(error); else throw error;
    }
  };

  THREE.GLTFLoader = GLTFLoader;
})(window.THREE);
