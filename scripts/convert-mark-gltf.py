# Sketchfab glTF (kemikler yeniden adlandırılmış, dokular 2K) -> temiz mark.glb
import bpy, sys
src, out = sys.argv[-2:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
# pozu temizle (dosya bekleme pozunda kaydedilmiş)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='POSE')
bpy.ops.pose.select_all(action='SELECT')
bpy.ops.pose.transforms_clear()
bpy.ops.object.mode_set(mode='OBJECT')
# tüm nesneleri tek kök altında, ölçek/dönüş uygulanmış hale getir
for o in bpy.data.objects:
    o.select_set(o.type in ('ARMATURE', 'MESH'))
for o in [o for o in bpy.data.objects if o.type in ('ARMATURE', 'MESH')]:
    mw = o.matrix_world.copy()
    if o.parent and o.parent.type not in ('ARMATURE',):
        o.parent = None
        o.matrix_world = mw
bpy.context.view_layer.objects.active = arm
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
for o in list(bpy.data.objects):
    if o.type == 'EMPTY': bpy.data.objects.remove(o, do_unlink=True)
print('ARM dims', tuple(round(d, 3) for d in arm.dimensions), 'bones', len(arm.data.bones))
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_skins=True, export_animations=False, export_morph=False, export_image_format='AUTO', export_yup=True)
print('OUT', out)
