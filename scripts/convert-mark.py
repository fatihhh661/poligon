import bpy, sys
src, out = sys.argv[-2:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=src)
arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
M = {'Hip':'Hips','Waist':'Spine','Spine01':'Spine1','Spine02':'Spine2','NeckTwist01':'Neck','Head':'Head'}
for s, m in (('L','Left'),('R','Right')):
    M.update({f'{s}_Clavicle':f'{m}Shoulder', f'{s}_Upperarm':f'{m}Arm', f'{s}_Forearm':f'{m}ForeArm', f'{s}_Hand':f'{m}Hand',
              f'{s}_Thigh':f'{m}UpLeg', f'{s}_Calf':f'{m}Leg', f'{s}_Foot':f'{m}Foot', f'{s}_ToeBase':f'{m}ToeBase'})
    for f, mf in (('Index','Index'),('Mid','Middle'),('Ring','Ring'),('Pinky','Pinky'),('Thumb','Thumb')):
        for i in (1,2,3): M[f'{s}_{f}{i}'] = f'{m}Hand{mf}{i}'
n = 0
for b in arm.data.bones:
    k = b.name.replace('CC_Base_', '')
    if k in M:
        new = 'mixamorig' + M[k]
        for o in bpy.data.objects:
            if o.type == 'MESH' and b.name in o.vertex_groups: o.vertex_groups[b.name].name = new
        b.name = new; n += 1
print('RENAMED', n)
for im in list(bpy.data.images): bpy.data.images.remove(im)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_skins=True, export_animations=False, export_morph=False, export_image_format='NONE', export_yup=True)
print('OUT', out)
