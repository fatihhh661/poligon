# Mark_1_Olive_IdlePose.fbx + Sketchfab dokuları (2K) -> app/assets/models/mark.glb
import bpy, sys, os
src, texdir, out = sys.argv[-3:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=src)
arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
M = {'Hip':'Hips','Waist':'Spine','Spine01':'Spine1','Spine02':'Spine2','NeckTwist01':'Neck','Head':'Head'}
for s, m in (('L','Left'),('R','Right')):
    M.update({f'{s}_Clavicle':f'{m}Shoulder', f'{s}_Upperarm':f'{m}Arm', f'{s}_Forearm':f'{m}ForeArm', f'{s}_Hand':f'{m}Hand',
              f'{s}_Thigh':f'{m}UpLeg', f'{s}_Calf':f'{m}Leg', f'{s}_Foot':f'{m}Foot', f'{s}_ToeBase':f'{m}ToeBase'})
    for f, mf in (('Index','Index'),('Mid','Middle'),('Ring','Ring'),('Pinky','Pinky'),('Thumb','Thumb')):
        for i in (1,2,3): M[f'{s}_{f}{i}'] = f'{m}Hand{mf}{i}'
for b in arm.data.bones:
    k = b.name.replace('CC_Base_', '')
    if k in M:
        new = 'mixamorig' + M[k]
        for o in bpy.data.objects:
            if o.type == 'MESH' and b.name in o.vertex_groups: o.vertex_groups[b.name].name = new
        b.name = new
files = {os.path.splitext(f)[0]: os.path.join(texdir, f) for f in os.listdir(texdir)}
def img(name, color=True):
    p = files.get(name)
    if not p: return None
    im = bpy.data.images.load(p, check_existing=True)
    im.colorspace_settings.name = 'sRGB' if color else 'Non-Color'
    return im
done = 0
for mat in bpy.data.materials:
    base = mat.name.split('.')[0]
    bc, nm, mr = img(base + '_baseColor'), img(base + '_normal', False), img(base + '_metallicRoughness', False)
    if not bc and not nm: continue
    mat.use_nodes = True
    nt = mat.node_tree; nt.nodes.clear()
    outn = nt.nodes.new('ShaderNodeOutputMaterial'); bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(bsdf.outputs['BSDF'], outn.inputs['Surface'])
    if bc:
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = bc
        nt.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
    if nm:
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = nm
        n = nt.nodes.new('ShaderNodeNormalMap'); nt.links.new(t.outputs['Color'], n.inputs['Color']); nt.links.new(n.outputs['Normal'], bsdf.inputs['Normal'])
    if mr:
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = mr
        sp = nt.nodes.new('ShaderNodeSeparateColor'); nt.links.new(t.outputs['Color'], sp.inputs['Color'])
        nt.links.new(sp.outputs['Green'], bsdf.inputs['Roughness']); nt.links.new(sp.outputs['Blue'], bsdf.inputs['Metallic'])
    else:
        bsdf.inputs['Roughness'].default_value = 0.85
    done += 1
print('MATERIALS', done, [m.name for m in bpy.data.materials])
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_skins=True, export_animations=False, export_morph=False, export_image_format='AUTO', export_yup=True)
print('OUT', out)
