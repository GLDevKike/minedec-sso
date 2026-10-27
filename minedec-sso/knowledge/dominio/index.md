<!-- description: Modelo de dominio: poblaciones de usuarios, Matriz Maestra Canónica de Atributos GWS (MINEDEC_Perfil), catálogos cerrados, modelo relacional en AlloyDB y cruce de autorización RBAC + ABAC. -->

# Concepts

* [Actores, Poblaciones de Usuarios y Ciclo de Vida de Identidades](actores-y-poblaciones.md) - Modela las cuatro poblaciones de usuarios del ecosistema MINEDEC, el alcance exclusivo de personas naturales (RF-GI-03, RF-UEX-02), el identificador natural único (Cédula/Pasaporte/Código MINEDEC) y los 3 roles administrativos de la consola (C2-50 Tabla 13).
* [Esquema de Identidad MINEDEC_Perfil y Modelo de Datos en AlloyDB](identidad-esquema-minedec-perfil.md) - Especifica cómo los 21 atributos canónicos de la Matriz de GWS (customSchemas.MINEDEC_Perfil) se sincronizan y articulan con el modelo relacional de AlloyDB en Conecta MINEDEC.
* [Matriz Maestra Canónica de Atributos GWS, Catálogos Cerrados, OUs y Scopes API](matriz-atributos-gws-catalogos.md) - Especificación íntegra extraída de Matriz de Atributos GWS _ SSO (3).xlsx con los 21 atributos exactos de customSchemas.MINEDEC_Perfil, obligatoriedad por población, catálogos cerrados, jerarquía de OUs y scopes DWD.
* [Modelo de Autorización Híbrido RBAC + ABAC y Cruce con la Matriz de Atributos GWS](modelo-autorizacion-rbac-abac.md) - Especifica cómo el motor PDP de Conecta MINEDEC ejecuta el cruce entre las dimensiones RBAC (tipoUsuario, subtipoUsuario, cargoFuncion y roles de app) y las dimensiones ABAC (territorial, académica, administrativa, multicartera y vigencia) de la Matriz de GWS.
